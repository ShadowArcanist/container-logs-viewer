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
	parts := strings.Split(name, "-")
	if len(parts) > 1 && parts[len(parts)-1] != "" {
		base := strings.Join(parts[:len(parts)-1], "-")
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
	go s.logCollectionWatcher(ctx)
	log.Printf("[backend] Server initialized")
}

func (s *Server) containerWatcher(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.checkContainerUpdates(ctx)
		}
	}
}

func (s *Server) logCollectionWatcher(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
	currentContainer, err := s.docker.FindContainerByName(ctx, container.ContainerName)
	if err != nil {
		log.Printf("[backend] Failed to find container by name %s: %v", container.ContainerName, err)
	}

	currentContainerID := container.ContainerID
	if currentContainer != nil && currentContainer.ID != container.ContainerID {
		log.Printf("[backend] Container ID changed for %s: %s -> %s", container.ContainerName, container.ContainerID[:12], currentContainer.ID[:12])
		oldID := container.ContainerID
		container.ContainerID = currentContainer.ID
		currentContainerID = currentContainer.ID

		_, err := s.db.SwapContainer(oldID, currentContainer.ID, container.ContainerName)
		if err != nil {
			log.Printf("[backend] Failed to update container ID: %v", err)
		}
	}

	lastLogTs, err := s.db.GetLastLogTimestamp(container.ID)
	if err != nil {
		log.Printf("[backend] Failed to get last log timestamp: %v", err)
	}

	since := time.Now().Add(-1 * time.Hour)
	if lastLogTs > 0 {
		since = time.Unix(0, lastLogTs)
	}

	logsChan, err := s.docker.StreamContainerLogs(ctx, currentContainerID, since)
	if err != nil {
		log.Printf("[backend] Failed to start log stream for %s: %v", container.ContainerName, err)
		return
	}

	var lastTimestamp int64
	for logEntry := range logsChan {
		entry := s.parseLogEntry(logEntry.Log, container.ContainerID, logEntry.Timestamp)
		entry.TrackedContainerID = container.ID
		if entry.Message == "" {
			continue
		}
		if err := s.db.AddLog(ctx, &entry); err != nil {
			log.Printf("[backend] Failed to persist log for %s: %v", container.ContainerName, err)
		} else {
			if entry.Timestamp > lastTimestamp {
				lastTimestamp = entry.Timestamp
			}
			s.hub.BroadcastToContainer(container.ID, websocket.NewLogMessage(entry))
		}
	}
	if lastTimestamp > 0 {
		if err := s.db.UpdateLastLogTimestamp(container.ID, lastTimestamp); err != nil {
			log.Printf("[backend] Failed to update last log timestamp: %v", err)
		}
	}
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

	swappedContainers := make(map[string]bool)
	for _, dbContainer := range containers {
		if _, exists := dockerMap[dbContainer.ContainerID]; !exists {
			if newID, exists := dockerMap[dbContainer.ContainerName]; exists {
				oldID := dbContainer.ContainerID
				oldLastLogTs, err := s.db.SwapContainer(dbContainer.ContainerID, newID, dbContainer.ContainerName)
				if err != nil {
					log.Printf("[backend] Failed to swap container: %v", err)
					continue
				}

				swapTimestamp := time.Now().UnixNano()
				if oldLastLogTs > 0 {
					swapTimestamp = oldLastLogTs + 1
				}
				systemLog := models.LogEntry{
					ID:                 uuid.New().String(),
					TrackedContainerID: dbContainer.ID,
					ContainerID:        newID,
					Timestamp:          swapTimestamp,
					Message:            fmt.Sprintf("[SYSTEM] Container swapped from %s to %s", oldID[:12], newID[:12]),
				}
				if err := s.db.AddLog(ctx, &systemLog); err != nil {
					log.Printf("[backend] Failed to add system log: %v", err)
				}
				s.hub.BroadcastToContainer(dbContainer.ID, websocket.NewContainerSwappedMessage(newID, dbContainer.ContainerName))

				updatedContainer, err := s.db.GetContainerByID(dbContainer.ID)
				if err == nil && updatedContainer != nil {
					bgCtx := context.Background()
					go s.collectLogsForContainer(bgCtx, *updatedContainer)
				}

				logs, err := s.db.GetLogs(dbContainer.ID, 1000, nil)
				if err != nil {
					log.Printf("[backend] Failed to fetch logs after swap: %v", err)
				} else {
					s.hub.BroadcastToContainer(dbContainer.ID, websocket.NewLogsBatchMessage(logs))
				}
				swappedContainers[dbContainer.ID] = true
				continue
			}

			basePrefix := getContainerBasePrefix(dbContainer.ContainerName)
			for name, id := range dockerMap {
				if strings.HasPrefix(name, basePrefix) {
					oldID := dbContainer.ContainerID
					oldLastLogTs, err := s.db.SwapContainer(dbContainer.ContainerID, id, name)
					if err != nil {
						log.Printf("[backend] Failed to swap container: %v", err)
						continue
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

					updatedContainer, err := s.db.GetContainerByID(dbContainer.ID)
					if err == nil && updatedContainer != nil {
						bgCtx := context.Background()
						go s.collectLogsForContainer(bgCtx, *updatedContainer)
					}

					logs, err := s.db.GetLogs(dbContainer.ID, 1000, nil)
					if err != nil {
						log.Printf("[backend] Failed to fetch logs after swap: %v", err)
					} else {
						s.hub.BroadcastToContainer(dbContainer.ID, websocket.NewLogsBatchMessage(logs))
					}
					swappedContainers[dbContainer.ID] = true
					break
				}
			}
		}
	}

	if len(swappedContainers) > 0 {
		containers, err = s.db.GetAllContainers()
		if err != nil {
			log.Printf("[backend] Failed to get containers after swap: %v", err)
			return
		}
	}

	statusChanged := false
	for i := range containers {
		container := &containers[i]
		inspectCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
		dockerContainer, err := s.docker.InspectContainer(inspectCtx, container.ContainerID)
		cancel()

		if err != nil {
			if container.Status != "unknown" {
				container.Status = "unknown"
				statusChanged = true
				if err := s.db.UpdateContainerStatus(container.ID, "unknown"); err != nil {
					log.Printf("[backend] Failed to update container status: %v", err)
				}
			}
			continue
		}

		newStatus := dockerContainer.State.Status
		if container.Status != newStatus {
			container.Status = newStatus
			statusChanged = true
			if err := s.db.UpdateContainerStatus(container.ID, newStatus); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
			}
		}
	}

	if statusChanged {
		s.hub.Broadcast(websocket.NewContainersMessage(containers))
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

	bgCtx := context.Background()
	go s.collectLogsForContainer(bgCtx, *addedContainer)

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
			if err := s.db.UpdateContainerStatus(container.ID, "unknown"); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
			}
			continue
		}

		newStatus := dockerContainer.State.Status
		if container.Status != newStatus {
			container.Status = newStatus
			if err := s.db.UpdateContainerStatus(container.ID, newStatus); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
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
		newStatus := dockerContainer.State.Status
		if container.Status != newStatus {
			container.Status = newStatus
			if err := s.db.UpdateContainerStatus(container.ID, newStatus); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
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
		if entry.Message == "" {
			continue
		}
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
			remaining := strings.TrimSpace(message[idx+1:])
			if remaining != "" {
				message = remaining
			}
		}
	}

	message = stripANSIColors(message)

	entry := models.LogEntry{
		ID:          uuid.New().String(),
		ContainerID: containerID,
		Timestamp:   timestamp.UnixNano(),
		Message:     message,
	}

	return entry
}

func stripANSIColors(s string) string {
	ansi := regexp.MustCompile(`\x1b\[[0-9;]*m`)
	s = ansi.ReplaceAllString(s, "")
	ansiPartial := regexp.MustCompile(`\[[0-9;]*m`)
	s = ansiPartial.ReplaceAllString(s, "")
	return s
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
			if err := s.db.UpdateContainerStatus(container.ID, "unknown"); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
			}
			continue
		}
		newStatus := dockerContainer.State.Status
		if container.Status != newStatus {
			container.Status = newStatus
			if err := s.db.UpdateContainerStatus(container.ID, newStatus); err != nil {
				log.Printf("[backend] Failed to update container status: %v", err)
			}
		}
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
