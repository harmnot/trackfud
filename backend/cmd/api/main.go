// Trackfud API entrypoint (Milestone B0+B1).
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"Trackfud/internal/app"
	"Trackfud/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()
	var pool *pgxpool.Pool
	for i := 0; i < 30; i++ {
		pool, err = pgxpool.New(ctx, cfg.DatabaseURL)
		if err == nil {
			err = pool.Ping(ctx)
		}
		if err == nil {
			break
		}
		log.Warn("waiting for database", "attempt", i+1, "err", err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Error("database unreachable", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	migDir := os.Getenv("TF_MIGRATIONS_DIR")
	if migDir == "" {
		migDir = "db/migrations"
	}
	if err := app.Migrate(ctx, pool, migDir); err != nil {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}
	srv := app.New(cfg, pool, log)
	if cfg.Server.DemoMode {
		if err := srv.SeedDemo(ctx); err != nil {
			log.Warn("seed demo", "err", err)
		}
	} else {
		if err := srv.SeedTestAccounts(ctx); err != nil {
			log.Warn("seed test accounts", "err", err)
		}
	}
	srv.StartWorker()
	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Error("upload dir", "upload_dir", cfg.UploadDir, "err", err)
		os.Exit(1)
	}
	log.Info("Trackfud api listening", "addr", cfg.Server.Addr, "demo_mode", cfg.Server.DemoMode)
	if err := http.ListenAndServe(cfg.Server.Addr, srv.Routes()); err != nil {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}
