package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/docker-logs-viewer/backend/internal/models"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type SQLiteDB struct {
	db        *sql.DB
	retention *RetentionManager
	mu        sync.RWMutex
}

func NewSQLiteDB(path string) (*SQLiteDB, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	if _, err := db.Exec("PRAGMA busy_timeout=30000"); err != nil {
		return nil, fmt.Errorf("failed to set busy timeout: %w", err)
	}

	sdb := &SQLiteDB{
		db:        db,
		retention: NewRetentionManager(db),
	}

	if err := sdb.createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	go sdb.walCheckpointLoop()

	return sdb, nil
}

func (s *SQLiteDB) walCheckpointLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if _, err := s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		}
	}
}

func (s *SQLiteDB) createTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS containers (
			id TEXT PRIMARY KEY,
			container_id TEXT NOT NULL UNIQUE,
			container_name TEXT NOT NULL,
			alias TEXT NOT NULL,
			added_at INTEGER NOT NULL,
			swapped_at INTEGER DEFAULT 0,
			status TEXT DEFAULT 'unknown',
			max_period INTEGER DEFAULT 0,
			max_lines INTEGER DEFAULT 0,
			server_name TEXT DEFAULT '',
			last_log_timestamp INTEGER DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS logs (
			id TEXT PRIMARY KEY,
			tracked_container_id TEXT NOT NULL,
			container_id TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			message TEXT NOT NULL,
			FOREIGN KEY (tracked_container_id) REFERENCES containers(id) ON DELETE CASCADE,
			UNIQUE (tracked_container_id, timestamp, message)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_logs_container_timestamp ON logs(tracked_container_id, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_logs_container ON logs(tracked_container_id)`,
		`CREATE INDEX IF NOT EXISTS idx_containers_name ON containers(container_name)`,
		`CREATE INDEX IF NOT EXISTS idx_containers_last_log ON containers(last_log_timestamp)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
	}

	if err := s.runMigrations(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

func (s *SQLiteDB) runMigrations() error {
	_, err := s.db.Exec(`ALTER TABLE containers ADD COLUMN last_log_timestamp INTEGER DEFAULT 0`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}

	_, err = s.db.Exec(`ALTER TABLE containers ADD COLUMN swapped_at INTEGER DEFAULT 0`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}

	_, err = s.db.Exec(`ALTER TABLE logs ADD COLUMN tracked_container_id TEXT DEFAULT ''`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}

	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_containers_last_log ON containers(last_log_timestamp)`)
	if err != nil && !strings.Contains(err.Error(), "index") {
		return err
	}

	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_logs_container_timestamp ON logs(tracked_container_id, timestamp DESC)`)
	if err != nil && !strings.Contains(err.Error(), "index") {
		return err
	}

	_, err = s.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_unique ON logs(tracked_container_id, timestamp, message)`)
	if err != nil && !strings.Contains(err.Error(), "index") {
		return err
	}

	return nil
}

func (s *SQLiteDB) Close() error {
	return s.db.Close()
}

func (s *SQLiteDB) AddContainer(req *models.AddContainerRequest, containerID, containerName, serverName string) (*models.Container, error) {
	id := uuid.New().String()
	now := time.Now().Unix()

	query := `INSERT INTO containers (id, container_id, container_name, alias, added_at, swapped_at, status, max_period, max_lines, server_name, last_log_timestamp)
	          VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?)`

	_, err := s.db.Exec(query, id, containerID, containerName, req.Alias, now, now, req.MaxPeriod, req.MaxLines, serverName, now)
	if err != nil {
		return nil, fmt.Errorf("failed to add container: %w", err)
	}

	return s.GetContainerByID(id)
}

func (s *SQLiteDB) SwapContainer(oldContainerID, newContainerID, newName string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var oldLastLogTs int64
	var internalID string
	err := s.db.QueryRow(`SELECT id, last_log_timestamp FROM containers WHERE container_id = ?`, oldContainerID).Scan(&internalID, &oldLastLogTs)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}

	now := time.Now().Unix()
	query := `UPDATE containers SET container_id = ?, container_name = ?, swapped_at = ?, last_log_timestamp = ? WHERE id = ?`
	_, err = s.db.Exec(query, newContainerID, newName, now, oldLastLogTs, internalID)
	if err != nil {
		return 0, fmt.Errorf("failed to swap container: %w", err)
	}

	_, err = s.db.Exec(`UPDATE logs SET container_id = ? WHERE tracked_container_id = ?`, newContainerID, internalID)

	return oldLastLogTs, nil
}

func (s *SQLiteDB) GetContainerByID(id string) (*models.Container, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query := `SELECT id, container_id, container_name, alias, added_at, swapped_at, status, max_period, max_lines, server_name
	          FROM containers WHERE id = ?`

	var c models.Container
	var alias, serverName sql.NullString
	var maxPeriod sql.NullInt64
	var maxLines sql.NullInt64

	err := s.db.QueryRow(query, id).Scan(
		&c.ID, &c.ContainerID, &c.ContainerName, &alias, &c.AddedAt, &c.SwappedAt,
		&c.Status, &maxPeriod, &maxLines, &serverName,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get container: %w", err)
	}

	c.Alias = alias.String
	c.ServerName = serverName.String
	if maxPeriod.Valid {
		c.MaxPeriod = maxPeriod.Int64
	}
	if maxLines.Valid {
		c.MaxLines = int(maxLines.Int64)
	}

	return &c, nil
}

func (s *SQLiteDB) GetAllContainers() ([]models.Container, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query := `SELECT id, container_id, container_name, alias, added_at, swapped_at, status, max_period, max_lines, server_name
	          FROM containers ORDER BY added_at DESC`

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query containers: %w", err)
	}
	defer rows.Close()

	var containers []models.Container
	for rows.Next() {
		var c models.Container
		var alias, serverName sql.NullString
		var maxPeriod sql.NullInt64
		var maxLines sql.NullInt64

		if err := rows.Scan(
			&c.ID, &c.ContainerID, &c.ContainerName, &alias, &c.AddedAt, &c.SwappedAt,
			&c.Status, &maxPeriod, &maxLines, &serverName,
		); err != nil {
			return nil, fmt.Errorf("failed to scan container: %w", err)
		}

		c.Alias = alias.String
		c.ServerName = serverName.String
		if maxPeriod.Valid {
			c.MaxPeriod = maxPeriod.Int64
		}
		if maxLines.Valid {
			c.MaxLines = int(maxLines.Int64)
		}

		containers = append(containers, c)
	}

	return containers, nil
}

func (s *SQLiteDB) UpdateContainerStatus(id string, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE containers SET status = ? WHERE id = ?`
	_, err := s.db.Exec(query, status, id)
	if err != nil {
		return fmt.Errorf("failed to update container status: %w", err)
	}
	return nil
}

func (s *SQLiteDB) UpdateContainerID(oldContainerID, newContainerID, newName string) error {
	query := `UPDATE containers SET container_id = ?, container_name = ? WHERE container_id = ?`
	_, err := s.db.Exec(query, newContainerID, newName, oldContainerID)
	if err != nil {
		return fmt.Errorf("failed to update container ID: %w", err)
	}
	return nil
}

func (s *SQLiteDB) ResetAddedAt(containerID string) error {
	query := `UPDATE containers SET added_at = ? WHERE container_id = ?`
	_, err := s.db.Exec(query, time.Now().Unix(), containerID)
	if err != nil {
		return fmt.Errorf("failed to reset added_at: %w", err)
	}
	return nil
}

func (s *SQLiteDB) RemoveContainer(id string) error {
	query := `DELETE FROM containers WHERE id = ?`
	_, err := s.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}
	return nil
}

func (s *SQLiteDB) UpdateContainer(id string, containerName, alias, serverName string, maxPeriod int64, maxLines int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE containers SET container_name = ?, alias = ?, server_name = ?, max_period = ?, max_lines = ? WHERE id = ?`
	_, err := s.db.Exec(query, containerName, alias, serverName, maxPeriod, maxLines, id)
	if err != nil {
		return fmt.Errorf("failed to update container: %w", err)
	}
	return nil
}

func (s *SQLiteDB) AddLog(ctx context.Context, logEntry *models.LogEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if logEntry.ID == "" {
		logEntry.ID = uuid.New().String()
	}

	query := `INSERT OR IGNORE INTO logs (id, tracked_container_id, container_id, timestamp, message) VALUES (?, ?, ?, ?, ?)`

	_, err := s.db.ExecContext(ctx, query, logEntry.ID, logEntry.TrackedContainerID, logEntry.ContainerID, logEntry.Timestamp, logEntry.Message)
	if err != nil {
		return fmt.Errorf("failed to add log: %w", err)
	}
	return nil
}

func (s *SQLiteDB) GetLastLogTimestamp(trackedContainerID string) (int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var timestamp int64
	err := s.db.QueryRow(`SELECT last_log_timestamp FROM containers WHERE id = ?`, trackedContainerID).Scan(&timestamp)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	return timestamp, nil
}

func (s *SQLiteDB) UpdateLastLogTimestamp(trackedContainerID string, timestamp int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`UPDATE containers SET last_log_timestamp = ? WHERE id = ?`, timestamp, trackedContainerID)
	return err
}

func (s *SQLiteDB) GetLogs(trackedContainerID string, limit int, before *time.Time) ([]models.LogEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var query strings.Builder
	query.WriteString(`SELECT id, container_id, timestamp, message FROM logs WHERE tracked_container_id = ?`)

	args := []interface{}{trackedContainerID}

	if before != nil {
		query.WriteString(` AND timestamp < ?`)
		args = append(args, before.UnixNano())
	}

	query.WriteString(` ORDER BY timestamp DESC LIMIT ?`)
	args = append(args, limit)

	rows, err := s.db.Query(query.String(), args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query logs: %w", err)
	}
	defer rows.Close()

	logs := make([]models.LogEntry, 0)
	for rows.Next() {
		var l models.LogEntry

		if err := rows.Scan(&l.ID, &l.ContainerID, &l.Timestamp, &l.Message); err != nil {
			return nil, fmt.Errorf("failed to scan log: %w", err)
		}

		logs = append(logs, l)
	}

	return logs, nil
}

func (s *SQLiteDB) GetLogCount(trackedContainerID string) (int, error) {
	query := `SELECT COUNT(*) FROM logs WHERE tracked_container_id = ?`
	var count int
	err := s.db.QueryRow(query, trackedContainerID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count logs: %w", err)
	}
	return count, nil
}

func (s *SQLiteDB) RetentionManager() *RetentionManager {
	return s.retention
}

func (s *SQLiteDB) DB() *sql.DB {
	return s.db
}
