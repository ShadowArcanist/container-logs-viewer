package docker

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type DockerClient struct {
	cli     *client.Client
	baseURL string
}

type LogMessage struct {
	Container string    `json:"container"`
	Log       string    `json:"log"`
	Timestamp time.Time `json:"timestamp"`
}

func NewDockerClient() (*DockerClient, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}

	baseURL := ""
	if cli != nil {
		baseURL = cli.DaemonHost()
	}

	return &DockerClient{
		cli:     cli,
		baseURL: baseURL,
	}, nil
}

func (d *DockerClient) Close() error {
	if d.cli != nil {
		return d.cli.Close()
	}
	return nil
}

func (d *DockerClient) ListContainers(ctx context.Context) ([]types.Container, error) {
	if d.cli == nil {
		return nil, fmt.Errorf("docker client not initialized")
	}

	containers, err := d.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	return containers, nil
}

func (d *DockerClient) FindContainerByName(ctx context.Context, name string) (*types.Container, error) {
	containers, err := d.ListContainers(ctx)
	if err != nil {
		return nil, err
	}

	for _, c := range containers {
		for _, n := range c.Names {
			cleanName := strings.TrimPrefix(n, "/")
			if cleanName == name {
				return &c, nil
			}
		}
	}

	exactMatch := strings.TrimPrefix(name, "/")

	for _, c := range containers {
		for _, n := range c.Names {
			cleanName := strings.TrimPrefix(n, "/")
			if strings.HasPrefix(cleanName, exactMatch) {
				return &c, nil
			}
		}

		if strings.HasPrefix(c.ID, exactMatch) {
			return &c, nil
		}
	}

	return nil, nil
}

func (d *DockerClient) StreamContainerLogs(ctx context.Context, containerID string, since time.Time) (<-chan LogMessage, error) {
	if d.cli == nil {
		return nil, fmt.Errorf("docker client not initialized")
	}

	logsChan := make(chan LogMessage)

	go func() {
		defer close(logsChan)

		opts := container.LogsOptions{
			ShowStdout: true,
			ShowStderr: true,
			Follow:     true,
			Tail:       "",
			Timestamps: true,
		}

		if !since.IsZero() {
			opts.Since = since.Format(time.RFC3339)
		}

		reader, err := d.cli.ContainerLogs(ctx, containerID, opts)
		if err != nil {
			log.Printf("[backend] ContainerLogs error for %s: %v", containerID, err)
			return
		}
		defer reader.Close()

		bufReader := bufio.NewReader(reader)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				line, err := bufReader.ReadBytes('\n')
				if err == io.EOF {
					return
				}
				if err != nil {
					log.Printf("[backend] Log stream error for %s: %v", containerID, err)
					return
				}

				lineStr := string(line)
				timestamp, cleanLog := parseDockerTimestamp(lineStr)

				if cleanLog != "" {
					logsChan <- LogMessage{
						Container: containerID,
						Log:       cleanLog,
						Timestamp: timestamp,
					}
				}
			}
		}
	}()

	return logsChan, nil
}

func cleanLogLine(line string) string {
	line = strings.TrimSpace(line)

	cleaned := make([]byte, 0, len(line))
	for i := 0; i < len(line); i++ {
		b := line[i]
		if b < 32 || b == 127 {
			continue
		}
		cleaned = append(cleaned, b)
	}

	return string(cleaned)
}

func parseDockerTimestamp(line string) (time.Time, string) {
	line = strings.TrimSpace(line)
	if len(line) < 2 {
		return time.Now(), line
	}

	if len(line) >= 8 && (line[0] == 1 || line[0] == 2) {
		line = line[8:]
	}

	for i := 0; i < len(line) && i < 100; i++ {
		b := line[i]
		if (b >= '0' && b <= '9') || b == '-' {
			line = line[i:]
			break
		}
	}

	idx := strings.Index(line, " ")
	if idx > 0 && idx < 50 {
		tsStr := line[:idx]
		ts, err := time.Parse(time.RFC3339Nano, tsStr)
		if err == nil {
			message := strings.TrimSpace(line[idx+1:])
			return ts, message
		}
	}

	if _, err := time.Parse(time.RFC3339Nano, line); err == nil {
		return time.Now(), ""
	}

	return time.Now(), line
}

func (d *DockerClient) InspectContainer(ctx context.Context, containerID string) (*types.ContainerJSON, error) {
	if d.cli == nil {
		return nil, fmt.Errorf("docker client not initialized")
	}

	resp, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %w", err)
	}

	return &resp, nil
}

func (d *DockerClient) IsSocketAccessible() bool {
	return d.cli != nil
}

func (d *DockerClient) PingDocker(ctx context.Context) error {
	if d.cli == nil {
		return fmt.Errorf("docker client not initialized")
	}

	_, err := d.cli.Ping(ctx)
	if err != nil {
		return fmt.Errorf("failed to ping docker daemon: %w", err)
	}

	return nil
}

func (d *DockerClient) DaemonHost() string {
	return d.baseURL
}

type ContainerInfo struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Image   string    `json:"image"`
	Status  string    `json:"status"`
	Created time.Time `json:"created"`
	State   string    `json:"state"`
}

func (d *DockerClient) ListContainersInfo(ctx context.Context) ([]ContainerInfo, error) {
	containers, err := d.ListContainers(ctx)
	if err != nil {
		return nil, err
	}

	var info []ContainerInfo
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		info = append(info, ContainerInfo{
			ID:      c.ID,
			Name:    name,
			Image:   c.Image,
			Status:  c.Status,
			Created: time.Unix(c.Created, 0),
			State:   c.State,
		})
	}

	return info, nil
}

func (d *DockerClient) HTTPClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
	}
}

func (d *DockerClient) GetContainerStats(ctx context.Context, containerID string) error {
	if d.cli == nil {
		return fmt.Errorf("docker client not initialized")
	}

	stats, err := d.cli.ContainerStats(ctx, containerID, false)
	if err != nil {
		return fmt.Errorf("failed to get container stats: %w", err)
	}
	defer stats.Body.Close()

	var statsJSON map[string]interface{}
	if err := json.NewDecoder(stats.Body).Decode(&statsJSON); err != nil {
		return fmt.Errorf("failed to decode stats: %w", err)
	}

	_ = statsJSON
	return nil
}
