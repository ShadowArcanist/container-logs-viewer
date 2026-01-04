package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"
)

type RetentionManager struct {
	db       *sql.DB
	stopChan chan struct{}
	doneChan chan struct{}
}

func NewRetentionManager(db *sql.DB) *RetentionManager {
	return &RetentionManager{
		db:       db,
		stopChan: make(chan struct{}),
		doneChan: make(chan struct{}),
	}
}

func (r *RetentionManager) Start(ctx context.Context, interval time.Duration) {
	go r.run(ctx, interval)
}

func (r *RetentionManager) Stop() {
	close(r.stopChan)
	<-r.doneChan
}

func (r *RetentionManager) run(ctx context.Context, interval time.Duration) {
	defer close(r.doneChan)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-r.stopChan:
			return
		case <-ticker.C:
			if err := r.applyRetentionPolicies(ctx); err != nil {
				log.Printf("[backend] Failed to apply retention policies: %v", err)
			}
		}
	}
}

func (r *RetentionManager) ApplyRetentionForContainer(ctx context.Context, containerID string, maxPeriod int64, maxLines int) error {
	if maxPeriod == 0 && maxLines == 0 {
		return nil
	}

	var removed int64
	var err error

	if maxLines > 0 {
		removed, err = r.enforceLineLimit(ctx, containerID, maxLines)
		if err != nil {
			return fmt.Errorf("failed to enforce line limit: %w", err)
		}
	}

	if maxPeriod > 0 {
		cutoff := time.Now().Unix() - maxPeriod
		removed2, err := r.enforceTimeLimit(ctx, containerID, cutoff)
		if err != nil {
			return fmt.Errorf("failed to enforce time limit: %w", err)
		}
		removed += removed2
	}

	if removed > 0 {
		log.Printf("[backend] Cleaned %d old log entries for container %s", removed, containerID)
	}

	return nil
}

func (r *RetentionManager) enforceLineLimit(ctx context.Context, trackedContainerID string, maxLines int) (int64, error) {
	var total int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM logs WHERE tracked_container_id = ?`, trackedContainerID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("failed to count logs: %w", err)
	}

	if total <= maxLines {
		return 0, nil
	}

	toRemove := total - maxLines

	result, err := r.db.ExecContext(ctx,
		`DELETE FROM logs WHERE tracked_container_id = ? AND id IN (
			SELECT id FROM logs WHERE tracked_container_id = ? ORDER BY timestamp ASC LIMIT ?
		)`,
		trackedContainerID, trackedContainerID, toRemove,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to delete old logs: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return affected, nil
}

func (r *RetentionManager) enforceTimeLimit(ctx context.Context, trackedContainerID string, cutoff int64) (int64, error) {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM logs WHERE tracked_container_id = ? AND timestamp < ?`,
		trackedContainerID, cutoff,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired logs: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return affected, nil
}

func (r *RetentionManager) applyRetentionPolicies(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, max_period, max_lines FROM containers WHERE max_period > 0 OR max_lines > 0`,
	)
	if err != nil {
		return fmt.Errorf("failed to query containers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var trackedContainerID string
		var maxPeriod int64
		var maxLines int

		if err := rows.Scan(&trackedContainerID, &maxPeriod, &maxLines); err != nil {
			log.Printf("[backend] Failed to scan container: %v", err)
			continue
		}

		if err := r.ApplyRetentionForContainer(ctx, trackedContainerID, maxPeriod, maxLines); err != nil {
			log.Printf("[backend] Failed to apply retention for %s: %v", trackedContainerID, err)
		}
	}

	return nil
}

func (r *RetentionManager) CleanupOrphanedLogs(ctx context.Context) error {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM logs WHERE tracked_container_id NOT IN (SELECT id FROM containers)`,
	)
	if err != nil {
		return fmt.Errorf("failed to cleanup orphaned logs: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if affected > 0 {
		log.Printf("[backend] Cleaned %d orphaned log entries", affected)
	}

	return nil
}
