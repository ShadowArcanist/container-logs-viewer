package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/docker-logs-viewer/backend/internal/models"
	"github.com/gorilla/websocket"
)

type Client struct {
	Conn        *websocket.Conn
	Send        chan []byte
	Hub         *Hub
	ContainerID string
	mu          sync.Mutex
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(512 * 1024)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {

			break
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) Broadcast(message interface{}) {
	msg, err := json.Marshal(message)
	if err != nil {
		log.Printf("[websocket] Failed to marshal message: %v", err)
		return
	}

	select {
	case h.broadcast <- msg:
	default:
	}
}

func (h *Hub) SendToClient(client *Client, message interface{}) {
	msg, err := json.Marshal(message)
	if err != nil {
		log.Printf("[websocket] Failed to marshal message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if _, ok := h.clients[client]; !ok {
		return
	}

	select {
	case client.Send <- msg:
	default:
	}
}

func (h *Hub) BroadcastToContainer(containerID string, message interface{}) {
	msg, err := json.Marshal(message)
	if err != nil {
		log.Printf("[websocket] Failed to marshal message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.ContainerID == containerID {
			select {
			case client.Send <- msg:
			default:
			}
		}
	}
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

type WSLogMessage struct {
	Type    string          `json:"type"`
	Payload models.LogEntry `json:"payload"`
}

type WSLogsBatchMessage struct {
	Type    string            `json:"type"`
	Payload []models.LogEntry `json:"payload"`
}

type WSContainerSwappedMessage struct {
	Type             string `json:"type"`
	NewContainerID   string `json:"newContainerId"`
	NewContainerName string `json:"newContainerName"`
}

type WSContainersMessage struct {
	Type       string             `json:"type"`
	Containers []models.Container `json:"containers"`
}

type WSControlMessage struct {
	Type    string `json:"type"`
	Payload string `json:"payload"`
}

type WSStatusMessage struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

func NewLogMessage(log models.LogEntry) WSLogMessage {
	return WSLogMessage{
		Type:    "log",
		Payload: log,
	}
}

func NewLogsBatchMessage(logs []models.LogEntry) WSLogsBatchMessage {
	return WSLogsBatchMessage{
		Type:    "logs_batch",
		Payload: logs,
	}
}

func NewContainerSwappedMessage(containerID, containerName string) WSContainerSwappedMessage {
	return WSContainerSwappedMessage{
		Type:             "container_swapped",
		NewContainerID:   containerID,
		NewContainerName: containerName,
	}
}

func NewContainersMessage(containers []models.Container) WSContainersMessage {
	return WSContainersMessage{
		Type:       "containers",
		Containers: containers,
	}
}

func NewControlMessage(action string) WSControlMessage {
	return WSControlMessage{
		Type:    "control",
		Payload: action,
	}
}

func NewErrorMessage(err string) WSControlMessage {
	return WSControlMessage{
		Type:    "error",
		Payload: err,
	}
}

func NewStatusMessage(status string) WSStatusMessage {
	return WSStatusMessage{
		Type:   "status",
		Status: status,
	}
}
