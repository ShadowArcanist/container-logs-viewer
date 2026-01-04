package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/docker-logs-viewer/backend/internal/db"
	"github.com/docker-logs-viewer/backend/internal/docker"
	"github.com/docker-logs-viewer/backend/internal/models"
	"github.com/docker-logs-viewer/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	ws "github.com/gorilla/websocket"
)

type Server struct {
	db         *db.SQLiteDB
	docker     *docker.DockerClient
	hub        *websocket.Hub
	staticPath string
}

func getContainerBasePrefix(name string) string {
	matched := regexp.MustCompile(`^(.+?)-?\d*$`).FindStringSubmatch(name)
	if len(matched) > 1 {
		base := matched[1]
		if strings.HasSuffix(base, "-") {
			return base
		}
		return base + "-"
	}
	return name + "-"
}

func NewServer(database *db.SQLiteDB, dockerClient *docker.DockerClient, staticPath string) *Server {
	return &Server{
		db:         database,
		docker:     dockerClient,
		hub:        websocket.NewHub(),
		staticPath: staticPath,
	}
}

func (s *Server) Run(ctx context.Context) {
	go s.hub.Run()
	go s.containerWatcher(ctx)
	log.Printf("[backend] Server initialized")
}

func (s *Server) containerWatcher(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.checkContainerUpdates(ctx)
			s.collectLogsForAllContainers(ctx)
		}
	}
}

func (s *Server) collectLogsForAllContainers(ctx context.Context) {
	containers, err := s.db.GetAllContainers()
	if err != nil {
		log.Printf("[backend] Failed to get containers for log collection: %v", err)
		return
	}

	for _, container := range containers {
		s.collectLogsForContainer(ctx, container)
	}
}

func (s *Server) collectLogsForContainer(ctx context.Context, container models.Container) {
	lastLogTs, err := s.db.GetLastLogTimestamp(container.ID)
	if err != nil {
		log.Printf("[backend] Failed to get last log timestamp: %v", err)
	}

	since := time.Now().Add(-1 * time.Hour)
	if lastLogTs > 0 {
		since = time.Unix(0, lastLogTs)
	}

	logsChan, err := s.docker.StreamContainerLogs(ctx, container.ContainerID, since)
	if err != nil {
		log.Printf("[backend] Failed to start log stream for %s: %v", container.ContainerName, err)
		return
	}

	count := 0
	var lastTimestamp int64
	for logEntry := range logsChan {
		entry := s.parseLogEntry(logEntry.Log, container.ContainerID, logEntry.Timestamp)
		entry.TrackedContainerID = container.ID
		if err := s.db.AddLog(ctx, &entry); err != nil {
			log.Printf("[backend] Failed to persist log: %v", err)
		} else {
			count++
			if entry.Timestamp > lastTimestamp {
				lastTimestamp = entry.Timestamp
			}
			s.hub.BroadcastToContainer(container.ID, websocket.NewLogMessage(entry))
		}

		if container.MaxPeriod > 0 || container.MaxLines > 0 {
			s.db.RetentionManager().ApplyRetentionForContainer(ctx, container.ID, container.MaxPeriod, container.MaxLines)
		}
	}
	if lastTimestamp > 0 {
		if err := s.db.UpdateLastLogTimestamp(container.ID, lastTimestamp); err != nil {
			log.Printf("[backend] Failed to update last log timestamp: %v", err)
		}
	}

	log.Printf("[backend] Collected %d new logs from %s (lastTs=%d)", count, container.ContainerName, lastTimestamp)
}

func (s *Server) checkContainerUpdates(ctx context.Context) {
	containers, err := s.db.GetAllContainers()
	if err != nil {
		log.Printf("[backend] Failed to get containers: %v", err)
		return
	}

	dockerContainers, err := s.docker.ListContainers(ctx)
	if err != nil {
		log.Printf("[backend] Failed to list docker containers: %v", err)
		return
	}

	dockerMap := make(map[string]string)
	for _, c := range dockerContainers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		dockerMap[name] = c.ID
		dockerMap[c.ID] = c.ID
	}

	statusChanged := false
	for i := range containers {
		container := &containers[i]
		inspectCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
		dockerContainer, err := s.docker.InspectContainer(inspectCtx, container.ContainerID)
		cancel()

		if err != nil {
			container.Status = "unknown"
			statusChanged = true
			continue
		}

		container.Status = dockerContainer.State.Status
		if dockerContainer.State.StartedAt != "" {
			started, err := time.Parse(time.RFC3339, dockerContainer.State.StartedAt)
			if err == nil {
				container.Uptime = int64(time.Now().Sub(started).Seconds())
			}
		}
		statusChanged = true
	}

	if statusChanged {
		s.hub.Broadcast(websocket.NewContainersMessage(containers))
	}

	for _, dbContainer := range containers {
		if _, exists := dockerMap[dbContainer.ContainerID]; !exists {
			log.Printf("[backend] Container %s (%s) no longer exists, will check for recreation",
				dbContainer.ContainerName, dbContainer.ContainerID)

			basePrefix := getContainerBasePrefix(dbContainer.ContainerName)
			for name, id := range dockerMap {
				if strings.HasPrefix(name, basePrefix) {
					log.Printf("[backend] Found recreated container: %s -> %s", dbContainer.ContainerID, id)
					oldID := dbContainer.ContainerID
					oldLastLogTs, err := s.db.SwapContainer(dbContainer.ContainerID, id, name)
					if err != nil {
						log.Printf("[backend] Failed to swap container: %v", err)
					}

					swapTimestamp := time.Now().UnixNano()
					if oldLastLogTs > 0 {
						swapTimestamp = oldLastLogTs + 1
					}
					systemLog := models.LogEntry{
						ID:                 uuid.New().String(),
						TrackedContainerID: dbContainer.ID,
						ContainerID:        id,
						Timestamp:          swapTimestamp,
						Message:            fmt.Sprintf("[SYSTEM] Container swapped from %s to %s", oldID[:12], id[:12]),
					}
					if err := s.db.AddLog(ctx, &systemLog); err != nil {
						log.Printf("[backend] Failed to add system log: %v", err)
					}
					s.hub.BroadcastToContainer(dbContainer.ID, websocket.NewContainerSwappedMessage(id, name))

					logs, err := s.db.GetLogs(dbContainer.ID, 1000, nil)
					if err != nil {
						log.Printf("[backend] Failed to fetch logs after swap: %v", err)
					} else {
						s.hub.BroadcastToContainer(dbContainer.ID, websocket.NewLogsBatchMessage(logs))
					}
					break
				}
			}
		}
	}
}

func (s *Server) jsonError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(models.ErrorResponse{
		Error: message,
		Code:  http.StatusText(code),
	})
}

func (s *Server) HandleAddContainer(w http.ResponseWriter, r *http.Request) {
	var req models.AddContainerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Container name is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	container, err := s.docker.FindContainerByName(ctx, req.Name)
	if err != nil {
		log.Printf("[backend] Failed to find container: %v", err)
		s.jsonError(w, "Failed to find container", http.StatusInternalServerError)
		return
	}

	if container == nil {
		s.jsonError(w, "Container not found", http.StatusNotFound)
		return
	}

	containerName := ""
	if len(container.Names) > 0 {
		containerName = strings.TrimPrefix(container.Names[0], "/")
	}

	serverName := s.docker.DaemonHost()
	if req.ServerName != "" {
		serverName = req.ServerName
	}

	existingContainers, err := s.db.GetAllContainers()
	if err != nil {
		log.Printf("[backend] Failed to get existing containers: %v", err)
	}

	for _, c := range existingContainers {
		if c.ContainerID == container.ID {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(models.AddContainerResponse{
				Container: c,
				Success:   true,
				Message:   "Container already tracked",
			})
			return
		}
	}

	alias := req.Alias
	if alias == "" {
		alias = containerName
	}

	addedContainer, err := s.db.AddContainer(&req, container.ID, containerName, serverName)
	if err != nil {
		log.Printf("[backend] Failed to add container: %v", err)
		s.jsonError(w, "Failed to add container", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.AddContainerResponse{
		Container: *addedContainer,
		Success:   true,
	})
}

func (s *Server) HandleListContainers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	containers, err := s.db.GetAllContainers()
	if err != nil {
		log.Printf("[backend] Failed to list containers: %v", err)
		s.jsonError(w, "Failed to list containers", http.StatusInternalServerError)
		return
	}

	for i := range containers {
		container := &containers[i]
		inspectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		dockerContainer, err := s.docker.InspectContainer(inspectCtx, container.ContainerID)
		cancel()
		if err != nil {
			container.Status = "unknown"
			continue
		}

		container.Status = dockerContainer.State.Status
		if dockerContainer.State.StartedAt != "" {
			started, err := time.Parse(time.RFC3339, dockerContainer.State.StartedAt)
			if err != nil {
				log.Printf("[backend] Failed to parse StartedAt '%s': %v", dockerContainer.State.StartedAt, err)
			} else {
				container.Uptime = int64(time.Now().Sub(started).Seconds())
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.ContainerListResponse{
		Containers: containers,
	})
}

func (s *Server) HandleRemoveContainer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	if id == "" {
		s.jsonError(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	if err := s.db.RemoveContainer(id); err != nil {
		log.Printf("[backend] Failed to remove container: %v", err)
		s.jsonError(w, "Failed to remove container", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) HandleUpdateContainer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	if id == "" {
		s.jsonError(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	var req models.UpdateContainerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ContainerName == "" || req.Alias == "" {
		s.jsonError(w, "Container name and alias are required", http.StatusBadRequest)
		return
	}

	if err := s.db.UpdateContainer(id, req.ContainerName, req.Alias, req.ServerName, req.MaxPeriod, req.MaxLines); err != nil {
		log.Printf("[backend] Failed to update container: %v", err)
		s.jsonError(w, "Failed to update container", http.StatusInternalServerError)
		return
	}

	container, err := s.db.GetContainerByID(id)
	if err != nil || container == nil {
		s.jsonError(w, "Container not found after update", http.StatusNotFound)
		return
	}

	inspectCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	dockerContainer, err := s.docker.InspectContainer(inspectCtx, container.ContainerID)
	cancel()
	if err == nil {
		container.Status = dockerContainer.State.Status
		if dockerContainer.State.StartedAt != "" {
			started, err := time.Parse(time.RFC3339, dockerContainer.State.StartedAt)
			if err != nil {
				log.Printf("[backend] Failed to parse StartedAt '%s': %v", dockerContainer.State.StartedAt, err)
			} else {
				container.Uptime = int64(time.Now().Sub(started).Seconds())
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(container)
}

func (s *Server) HandleGetLogs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	containerID := vars["id"]

	if containerID == "" {
		s.jsonError(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	container, err := s.db.GetContainerByID(containerID)
	if err != nil {
		log.Printf("[backend] Failed to get container: %v", err)
		s.jsonError(w, "Failed to get container", http.StatusInternalServerError)
		return
	}

	if container == nil {
		s.jsonError(w, "Container not found", http.StatusNotFound)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	beforeStr := r.URL.Query().Get("before")
	var before *time.Time
	if beforeStr != "" {
		if t, err := time.Parse(time.RFC3339, beforeStr); err == nil {
			before = &t
		}
	}

	logs, err := s.db.GetLogs(container.ID, limit, before)
	if err != nil {
		log.Printf("[backend] Failed to get logs: %v", err)
		s.jsonError(w, "Failed to get logs", http.StatusInternalServerError)
		return
	}

	total, _ := s.db.GetLogCount(container.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.LogListResponse{
		Logs:    logs,
		HasMore: len(logs) == limit,
		Total:   total,
	})
}

var upgrader = ws.Upgrader{
	ReadBufferSize:  1024 * 1024,
	WriteBufferSize: 1024 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (s *Server) HandleStreamLogs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	containerID := vars["id"]

	if containerID == "" {
		s.jsonError(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	container, err := s.db.GetContainerByID(containerID)
	if err != nil {
		s.jsonError(w, "Container not found", http.StatusNotFound)
		return
	}

	if container == nil {
		s.jsonError(w, "Container not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[websocket] Failed to upgrade: %v", err)
		return
	}

	client := &websocket.Client{
		Conn:        conn,
		Send:        make(chan []byte, 256),
		Hub:         s.hub,
		ContainerID: containerID,
	}

	s.hub.Register(client)
	go client.WritePump()
	go client.ReadPump()

	logsChan, err := s.docker.StreamContainerLogs(r.Context(), container.ContainerID, time.Time{})
	if err != nil {
		log.Printf("[backend] Failed to stream logs: %v", err)
		s.hub.SendToClient(client, websocket.NewErrorMessage("Failed to start log streaming"))
		return
	}

	for logEntry := range logsChan {
		entry := s.parseLogEntry(logEntry.Log, container.ContainerID, logEntry.Timestamp)
		entry.TrackedContainerID = container.ID
		s.hub.SendToClient(client, websocket.NewLogMessage(entry))

		if err := s.db.AddLog(r.Context(), &entry); err != nil {
			log.Printf("[backend] Failed to persist log: %v", err)
		}

		if container.MaxPeriod > 0 || container.MaxLines > 0 {
			s.db.RetentionManager().ApplyRetentionForContainer(r.Context(), container.ID, container.MaxPeriod, container.MaxLines)
		}
	}
}

func (s *Server) parseLogEntry(logLine, containerID string, timestamp time.Time) models.LogEntry {
	message := strings.TrimSpace(logLine)

	if len(message) >= 8 && message[0] == 1 {
		message = message[8:]
	}

	idx := strings.Index(message, " ")
	if idx > 0 && idx < 50 {
		tsStr := message[:idx]
		if _, err := time.Parse(time.RFC3339Nano, tsStr); err == nil {
			message = strings.TrimSpace(message[idx+1:])
		}
	}

	entry := models.LogEntry{
		ID:          uuid.New().String(),
		ContainerID: containerID,
		Timestamp:   timestamp.UnixNano(),
		Message:     message,
	}

	return entry
}

func (s *Server) HandleWS(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	containerID := vars["id"]

	if containerID == "" {
		s.jsonError(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	container, err := s.db.GetContainerByID(containerID)
	if err != nil || container == nil {
		s.jsonError(w, "Container not found", http.StatusNotFound)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[websocket] Failed to upgrade: %v", err)
		return
	}

	client := &websocket.Client{
		Conn:        conn,
		Send:        make(chan []byte, 256),
		Hub:         s.hub,
		ContainerID: containerID,
	}

	s.hub.Register(client)
	go client.WritePump()
	go client.ReadPump()

	logs, err := s.db.GetLogs(container.ID, limit, nil)
	if err != nil {
		log.Printf("[backend] Failed to get existing logs: %v", err)
	} else {
		s.hub.SendToClient(client, websocket.NewLogsBatchMessage(logs))
	}
}

func (s *Server) HandleWSContainers(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[websocket] Failed to upgrade containers: %v", err)
		return
	}

	client := &websocket.Client{
		Conn:        conn,
		Send:        make(chan []byte, 256),
		Hub:         s.hub,
		ContainerID: "containers",
	}

	s.hub.Register(client)
	go client.WritePump()

	go func() {
		time.Sleep(200 * time.Millisecond)
		s.sendContainersUpdate(client)
	}()
}

func (s *Server) sendContainersUpdate(client *websocket.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	containers, err := s.db.GetAllContainers()
	if err != nil {
		return
	}

	for i := range containers {
		container := &containers[i]
		inspectCtx, inspectCancel := context.WithTimeout(ctx, 1*time.Second)
		dockerContainer, err := s.docker.InspectContainer(inspectCtx, container.ContainerID)
		inspectCancel()
		if err != nil {
			container.Status = "unknown"
			continue
		}
		container.Status = dockerContainer.State.Status
	}

	msg := websocket.NewContainersMessage(containers)
	s.hub.SendToClient(client, msg)
}

func (s *Server) HandleHealth(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
	}

	if err := s.docker.PingDocker(r.Context()); err != nil {
		status["docker"] = "unreachable"
		status["status"] = "degraded"
	} else {
		status["docker"] = "connected"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func (s *Server) HandleDockerContainers(w http.ResponseWriter, r *http.Request) {
	containers, err := s.docker.ListContainersInfo(r.Context())
	if err != nil {
		log.Printf("[backend] Failed to list docker containers: %v", err)
		s.jsonError(w, "Failed to list containers", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(containers)
}
