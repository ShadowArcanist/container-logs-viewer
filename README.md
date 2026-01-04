# Docker Logs Viewer

A real-time Docker container logs viewer with a modern web interface. Monitor, search, and filter logs from multiple containers in one place.

> [!IMPORTANT]  
> This app doesn't have any built in authentication so you have to use other available solutions like basic auth, cloudflare access etc..
> 
> This app is fully coded using AI but tested very well, so use it at your own risk.


## Features

### Real-Time Log Streaming
- **Live Updates**: WebSocket-powered real-time log streaming from Docker containers

### Log Management
- **Powerful Search**: Full-text search across log messages
- **Level Filtering**: Filter logs by severity levels (INFO, WARN, DEBUG, ERROR, SYSTEM)
- **Timestamp Sorting**: Sort logs chronologically (ascending/descending)
- **Follow Mode**: Auto-scroll to latest logs

### Container Management
- **Easy Setup**: Add containers by name with auto-discovery
- **Custom Aliases**: Set friendly aliases for your containers
- **Container Tracking**: Track container status (running, stopped, exited, restarting)

### Advanced Features
- **Log Retention**: Configurable retention policies by time period or max lines
- **Auto-Container Swap**: Automatically detects and handles container recreation
- **System Logs**: Special system logs for container swap events

## Screenshots

### Main Dashboard
Monitor all your tracked containers with status indicators and uptime information.

### Log Viewer
Real-time log streaming with powerful search and filtering capabilities.


## Quick Start
### Using Docker Compose (Recommended)

```bash
git clone https://github.com/ShadowArcanist/container-logs-viewer.git
cd container-logs-viewer
docker compose up -d
```

Access the application at `http://localhost:8080`

### Using Docker

```bash
docker build -t container-logs-viewer .
docker run -d \
  --name container-logs-viewer \
  -p 8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v docker-logs-data:/data \
  container-logs-viewer
```

### Development Setup

#### Frontend
```bash
cd frontend
bun install
bun run dev
```

#### Backend
```bash
cd backend
go run ./cmd/main.go -addr :8080 -db /tmp/app.db -static ../frontend/out
```

## Usage

### Adding a Container

1. Click "Add Container" in the main dashboard
2. Enter the Docker container name
3. (Optional) Set a custom alias
4. (Optional) Configure retention settings:
   - **Max Period**: Delete logs older than X days
   - **Max Lines**: Keep only the last X log entries
5. Click "Add Container"


### Viewing Logs

1. Select a container from the list
2. Logs will automatically stream in real-time
3. Use the search bar to filter by text
4. Toggle level filters to show specific log levels
5. Use pause/play to control log streaming

### Editing Container Settings

1. Click the edit (pencil) icon next to a container on tables view
2. Modify alias, retention settings, or server name
3. Save changes

## API Documentation

### Health Check
```http
GET /api/health
```

Returns the health status and Docker connection status.

### List Containers
```http
GET /api/containers
```

Returns all tracked containers with their status and uptime.

### Add Container
```http
POST /api/containers
Content-Type: application/json

{
  "name": "my-container",
  "alias": "My App",
  "serverName": "production",
  "maxPeriod": 7,
  "maxLines": 10000
}
```

### Update Container
```http
PUT /api/containers/{id}
Content-Type: application/json

{
  "containerName": "my-container",
  "alias": "My App",
  "serverName": "production",
  "maxPeriod": 7,
  "maxLines": 10000
}
```

### Remove Container
```http
DELETE /api/containers/{id}
```

### Get Logs
```http
GET /api/containers/{id}/logs?limit=100&before=2024-01-01T00:00:00Z
```

### WebSocket Endpoints
- `GET /api/ws/{id}` - Real-time log streaming for a container
- `GET /api/ws/containers` - Real-time container status updates

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `TZ` | `UTC` | Timezone |

### Command Line Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-addr` | `:8080` | HTTP listen address |
| `-db` | `/data/app.db` | Database file path |
| `-static` | `/app/frontend` | Static files directory |

## Tech Stack

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI Library**: React 19
- **Styling**: Tailwind CSS 4
- **Components**: shadcn/ui (Radix UI primitives)
- **Icons**: Lucide React
- **Forms**: React Hook Form + Zod validation
- **Real-time**: WebSocket API

### Backend
- **Language**: Go 1.24
- **HTTP Framework**: Gorilla Mux
- **WebSocket**: Gorilla WebSocket
- **Database**: SQLite with mattn/go-sqlite3
- **Docker Integration**: Docker SDK for Go

### Infrastructure
- **Container**: Docker
- **Reverse Proxy**: Compatible with Nginx, Traefik, Caddy
- **Health Checks**: Built-in health monitoring


## Production Deployment

### Docker Compose

The recommended production deployment uses Docker Compose:

```yaml
services:
  docker-logs-viewer:
    build:
      context: .
      dockerfile: Dockerfile
    image: ghcr.io/shadowarcanist/container-logs-viewer:latest
    container_name: docker-logs-viewer
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - docker-logs-data:/data
    environment:
      - TZ=UTC
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  docker-logs-data:
    driver: local

networks:
  default:
    name: docker-logs-network
```

