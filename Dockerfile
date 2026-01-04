FROM oven/bun AS frontend-builder

WORKDIR /app

COPY frontend/package.json frontend/bun.lock ./
RUN bun install

COPY frontend/ ./
RUN bun run build

FROM golang:1.24-alpine AS backend-builder

WORKDIR /build

RUN apk add --no-cache build-base

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o bin/server ./cmd/...

FROM alpine:3.19 AS runtime

RUN apk add --no-cache ca-certificates sqlite

WORKDIR /app

RUN mkdir -p /data /app/frontend

COPY --from=frontend-builder /app/out /app/frontend

COPY --from=backend-builder /build/bin/server /app/server

ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

CMD ["/app/server", "-addr", ":8080", "-db", "/data/app.db", "-static", "/app/frontend"]
