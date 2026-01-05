package models

type Container struct {
	ID            string `json:"id" db:"id"`
	ContainerID   string `json:"containerId" db:"container_id"`
	ContainerName string `json:"containerName" db:"container_name"`
	Alias         string `json:"alias" db:"alias"`
	AddedAt       int64  `json:"addedAt" db:"added_at"`
	SwappedAt     int64  `json:"swappedAt" db:"swapped_at"`
	Status        string `json:"status" db:"status"`
	MaxPeriod     int64  `json:"maxPeriod" db:"max_period"`
	MaxLines      int    `json:"maxLines" db:"max_lines"`
	ServerName    string `json:"serverName" db:"server_name"`
}

type LogEntry struct {
	ID                 string `json:"id" db:"id"`
	ContainerID        string `json:"containerId" db:"container_id"`
	TrackedContainerID string `json:"-" db:"tracked_container_id"`
	Timestamp          int64  `json:"timestamp" db:"timestamp"`
	Message            string `json:"message" db:"message"`
}

type AddContainerRequest struct {
	Name       string `json:"name" validate:"required"`
	Alias      string `json:"alias,omitempty"`
	MaxPeriod  int64  `json:"maxPeriod,omitempty"`
	MaxLines   int    `json:"maxLines,omitempty"`
	ServerName string `json:"serverName,omitempty"`
}

type UpdateContainerRequest struct {
	ContainerName string `json:"containerName"`
	Alias         string `json:"alias"`
	ServerName    string `json:"serverName"`
	MaxPeriod     int64  `json:"maxPeriod"`
	MaxLines      int    `json:"maxLines"`
}

type AddContainerResponse struct {
	Container Container `json:"container"`
	Success   bool      `json:"success"`
	Message   string    `json:"message,omitempty"`
}

type ContainerListResponse struct {
	Containers []Container `json:"containers"`
}

type LogListResponse struct {
	Logs    []LogEntry `json:"logs"`
	HasMore bool       `json:"hasMore"`
	Total   int        `json:"total"`
}

type ErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}
