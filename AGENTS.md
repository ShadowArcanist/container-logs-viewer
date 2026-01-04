# AGENTS.md

This document provides guidelines for AI agents working on this codebase.

## Project Overview

This is **container-log-viewer**, a Docker container logs viewer with a Next.js 16 frontend and Go backend. It uses React 19, TypeScript 5, Tailwind CSS, shadcn/ui, SQLite, and WebSocket for real-time log streaming.

## Build, Lint, and Test Commands

### Frontend (from `frontend/` directory)
| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server at http://localhost:3000 |
| `bun run build` | Build for production |
| `bun run lint` | Run ESLint |
| `bun test <file>` | Run single test file (if configured) |
| `bun test` | Run all tests (if configured) |

### Backend (from `backend/` directory)
| Command | Description |
|---------|-------------|
| `go build -o bin/server ./cmd/...` | Build the Go server |
| `go run ./cmd/main.go` | Run the server in development mode |
| `go test ./...` | Run all tests |
| `go test -v ./internal/handlers` | Run tests in specific package |
| `go test -run TestName ./internal/handlers` | Run single test |
| `go fmt ./...` | Format all Go code |
| `gofmt -w .` | Format current directory |

### Docker
| Command | Description |
|---------|-------------|
| `docker build -t docker-logs-viewer .` | Build the Docker image |
| `docker compose up -d` | Start with Docker Compose |
| `docker compose down` | Stop the application |

## Code Style Guidelines

### General Principles
- Write concise, self-documenting code
- Prefer explicit over implicit
- Follow existing patterns in the codebase
- Use meaningful variable and function names

### TypeScript (Frontend)
- `strict: true` enabled in tsconfig.json
- Use interfaces for object shapes, types for unions/primitives
- Avoid `any`; use `unknown` when type is truly uncertain
- Use explicit return types for public functions
- Absolute imports with `@/` alias (e.g., `@/components/ui/button`)

### Go (Backend)
- Use `gofmt` for formatting (default)
- Follow Effective Go conventions
- Handle errors explicitly
- Use context.Context for cancellation
- Prefix debug logs with `[backend]` (e.g., `log.Printf("[backend] Failed to...")`)

### Components (Frontend)
- Named exports: `export function ContainerList`
- Client components start with `"use client"` directive
- TypeScript interfaces for props
- Destructure props in function signature

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `ContainerList` |
| Hooks | camelCase with `use` prefix | `useLogStream` |
| Variables | camelCase | `activeFilters` |
| Constants | UPPER_SNAKE_CASE or camelCase | `MAX_LOGS` |
| Interfaces | PascalCase | `LogEntry` |
| Types | PascalCase | `Protocol` |
| Files | kebab-case | `log-stream.ts` |

### Import Order
1. `"use client"` directive (first line)
2. External dependencies (React, etc.)
3. Absolute imports from `@/`
4. Relative imports

### Tailwind CSS
- Use `cn()` utility from `@/lib/utils` to merge classes
- Organize classes: layout → sizing → spacing → typography → colors → effects
- Use semantic color tokens (e.g., `text-muted-foreground`, `bg-card/50`)
- Avoid hardcoded colors

### Error Handling
- Frontend: try/catch with descriptive messages, prefix with `[container-log-viewer]`
- Backend: explicit error handling with `log.Printf("[backend] ...")`
- Handle async errors explicitly
- Validate inputs at function boundaries

### State Management
- Use `useReducer` for complex state with multiple actions
- Use `useState` for simple state
- Use `useCallback` for callbacks passed to child components
- Persist important state to localStorage with error handling

## Architecture

### Frontend Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- WebSocket for real-time logs

### Backend Stack
- Go 1.24 + SQLite with mattn/go-sqlite3
- Gorilla Mux (HTTP) + Gorilla WebSocket
- Docker SDK for container access

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/containers` | List tracked containers |
| POST | `/api/containers` | Add container |
| DELETE | `/api/containers/{id}` | Remove container |
| PUT | `/api/containers/{id}` | Update container |
| GET | `/api/containers/{id}/logs` | Get logs |
| GET | `/api/ws/{id}` | WebSocket for real-time logs |
| GET | `/api/docker/containers` | List Docker containers |

### File Organization
```
frontend/
├── app/              # Next.js pages
├── components/
│   ├── network/      # Feature components
│   └── ui/           # shadcn/ui base
├── hooks/            # Custom React hooks
└── lib/              # Utilities, types

backend/
├── cmd/              # Entry points
└── internal/
    ├── db/           # Database layer
    ├── docker/       # Docker client
    ├── handlers/     # HTTP handlers
    ├── models/       # Data models
    └── websocket/    # WebSocket hub
```

## Common Tasks

### Adding a Component
Create in `components/network/` or appropriate subdirectory. Follow existing patterns and use `@/components/ui` primitives.

### Adding an API Endpoint
Add handler in `internal/handlers/handlers.go`, register route in `cmd/main.go` using gorilla/mux, add TypeScript types in `frontend/lib/types.ts`.

### Modifying Database Schema
Update `internal/models/models.go` for backend, `lib/types.ts` for frontend. Ensure migrations are handled in `internal/db/database.go`.

### Log Retention
Retention runs every 5 minutes. Adjust `maxPeriod` (days) and `maxLines` when adding containers. Trigger manually via `RetentionManager.ApplyRetentionForContainer()`.
