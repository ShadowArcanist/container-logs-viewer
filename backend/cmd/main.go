package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/docker-logs-viewer/backend/internal/db"
	"github.com/docker-logs-viewer/backend/internal/docker"
	"github.com/docker-logs-viewer/backend/internal/handlers"
	"github.com/gorilla/mux"
)

func main() {
	listenAddr := flag.String("addr", ":8080", "HTTP listen address")
	dbPath := flag.String("db", "/data/app.db", "Database path")
	staticPath := flag.String("static", "/app/frontend", "Static files directory")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)

	database, err := db.NewSQLiteDB(*dbPath)
	if err != nil {
		log.Fatalf("[backend] Failed to open database: %v", err)
	}
	defer database.Close()

	retentionCtx, retentionCancel := context.WithCancel(context.Background())
	defer retentionCancel()
	database.RetentionManager().Start(retentionCtx, 5*time.Minute)

	dockerClient, err := docker.NewDockerClient()
	if err != nil {
		log.Printf("[backend] Failed to create docker client: %v", err)
	} else {
		defer dockerClient.Close()

		if err := dockerClient.PingDocker(context.Background()); err != nil {
			log.Printf("[backend] Docker daemon not accessible: %v", err)
		}
	}

	server := handlers.NewServer(database, dockerClient, *staticPath)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server.Run(ctx)

	r := mux.NewRouter()

	staticDir := *staticPath
	indexFile := filepath.Join(staticDir, "index.html")

	staticHandler := &staticFileHandler{
		staticDir: staticDir,
		indexFile: indexFile,
		mimeTypes: map[string]string{
			".html":  "text/html",
			".js":    "application/javascript",
			".mjs":   "application/javascript",
			".css":   "text/css",
			".json":  "application/json",
			".png":   "image/png",
			".jpg":   "image/jpeg",
			".jpeg":  "image/jpeg",
			".gif":   "image/gif",
			".svg":   "image/svg+xml",
			".ico":   "image/x-icon",
			".woff":  "font/woff",
			".woff2": "font/woff2",
			".ttf":   "font/ttf",
			".eot":   "application/vnd.ms-fontobject",
		},
	}

	r.HandleFunc("/api/health", server.HandleHealth)
	r.HandleFunc("/api/containers", server.HandleListContainers).Methods("GET")
	r.HandleFunc("/api/containers", server.HandleAddContainer).Methods("POST")
	r.HandleFunc("/api/containers/{id}", server.HandleRemoveContainer).Methods("DELETE")
	r.HandleFunc("/api/containers/{id}", server.HandleUpdateContainer).Methods("PUT")
	r.HandleFunc("/api/containers/{id}/logs", server.HandleGetLogs).Methods("GET")
	r.HandleFunc("/api/containers/{id}/stream", server.HandleStreamLogs).Methods("GET")
	r.HandleFunc("/api/ws/containers", server.HandleWSContainers).Methods("GET")
	r.HandleFunc("/api/ws/{id}", server.HandleWS).Methods("GET")
	r.HandleFunc("/api/docker/containers", server.HandleDockerContainers).Methods("GET")

	r.PathPrefix("/").Handler(staticHandler)

	srv := &http.Server{
		Addr:         *listenAddr,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Printf("[backend] Shutting down...")
		retentionCancel()
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("[backend] Server shutdown error: %v", err)
		}
	}()

	log.Printf("[backend] Server listening on %s", *listenAddr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[backend] Server error: %v", err)
	}

	log.Printf("[backend] Server stopped")
}

type staticFileHandler struct {
	staticDir string
	indexFile string
	mimeTypes map[string]string
}

func (h *staticFileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws") {
		http.NotFound(w, r)
		return
	}

	filePath := filepath.Join(h.staticDir, path)

	info, err := os.Stat(filePath)
	if err == nil && !info.IsDir() {
		ext := strings.ToLower(filepath.Ext(filePath))
		if mimeType, ok := h.mimeTypes[ext]; ok {
			w.Header().Set("Content-Type", mimeType)
		}
		http.ServeFile(w, r, filePath)
		return
	}

	http.ServeFile(w, r, h.indexFile)
}
