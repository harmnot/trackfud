// Package config loads Trackfud configuration from YAML plus env overrides.
package config

import (
	"crypto/elliptic"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Dispatch holds track-corridor matching + cascade + scoring (plan §6).
type Dispatch struct {
	RunnerCorridorM, BikerCorridorM       float64
	RunnerMaxToPickupM, BikerMaxToPickupM float64
	RunnerMaxTripM, BikerMaxTripM         float64
	RunnerSizes, BikerSizes               []string
	RunnerPlanKmh, BikerPlanKmh           float64
	Circuity                              float64
	OfferWindowS                          int
	BroadcastWindowS                      int
	CascadeSize                           int
	SearchS                               int
	StaffS                                int
	RunnerMaxCarryS, BikerMaxCarryS       int
	WFit, WFoodWait, WRating, WIdle       float64
	HeadingPenalty                        float64
	DetourRefreshM                        float64
}

// Config holds all runtime settings.
type Config struct {
	Server struct {
		Addr, PublicBaseURL string
		DemoMode            bool
	} `yaml:"server"`
	Auth  struct{ AccessTTLSeconds, RefreshTTLSeconds int } `yaml:"auth"`
	Order struct {
		MerchantAcceptWindowS int `yaml:"merchant_accept_window_s"`
		WindowMinMinutes      int `yaml:"window_min_minutes"`
		WindowMaxMinutes      int `yaml:"window_max_minutes"`
	} `yaml:"order"`
	// Health holds the WHO active-minutes goal (plan section 2.1).
	Health struct {
		WhoWeeklyActiveMin int `yaml:"who_weekly_active_min"`
		DailyActiveCapMin  int `yaml:"daily_active_cap_min"`
	} `yaml:"health"`
	// Dispatch holds track-corridor matching + cascade + scoring (plan §6).
	// Named (not anonymous) so handlers can pass an effective copy
	// overlaid with A9 CMS overrides.
	Dispatch Dispatch `yaml:"dispatch"`
	// Maps holds the Google Routes API key (server-side only, plan §9).
	Maps struct {
		APIKey string
	} `yaml:"-"`
	// AI holds the model-serving wiring (B6): Modal-hosted chat/text by
	// default, Meta Model API direct as override. Credentials never leave
	// the server: they are absent from publicConfig and every API response.
	AI struct {
		MetaAPIKey       string
		MetaBaseURL      string
		SparkModel       string
		ContributorModel string
		TranscribeModel  string
		SAMModel         string
		// ModalKey/ModalSecret is the Modal proxy-token pair (wk-/ws-).
		// Env-only; never in config.yaml.
		ModalKey    string `yaml:"-"`
		ModalSecret string `yaml:"-"`
	} `yaml:"ai"`
	Fitness struct {
		RunnerDistanceM, BikerDistanceM       float64 `yaml:"runner_distance_m"`
		RunnerMovingLimitS, BikerMovingLimitS int     `yaml:"runner_moving_limit_s"`
		ElapsedCapMultiplier                  int     `yaml:"elapsed_cap_multiplier"`
	} `yaml:"fitness"`
	// Qualification holds fitness-test retry/gap rules (plan section 8.3).
	Qualification struct {
		RetryAfterS        int `yaml:"retry_after_s"`
		MaxAttemptsPerWeek int `yaml:"max_attempts_per_week"`
		MaxGapS            int `yaml:"max_gap_s"`
		CheckpointPhotos   int `yaml:"checkpoint_photos"`
	} `yaml:"qualification"`
	// Tracking holds GPS ingest + stats rules (plan sections 7.2-7.3).
	Tracking struct {
		MaxAccuracyM            float64 `yaml:"max_accuracy_m"`
		RunnerMaxSpeedKmh       float64 `yaml:"runner_max_speed_kmh"`
		BikerMaxSpeedKmh        float64 `yaml:"biker_max_speed_kmh"`
		MinMovingSpeedMps       float64 `yaml:"min_moving_speed_mps"`
		SegmentMaxGapS          int     `yaml:"segment_max_gap_s"`
		RunnerActiveMinSpeedKmh float64 `yaml:"runner_active_min_speed_kmh"`
		BikerActiveMinSpeedKmh  float64 `yaml:"biker_active_min_speed_kmh"`
		StaleAfterS             int     `yaml:"stale_after_s"`
		AutoEndAfterS           int     `yaml:"auto_end_after_s"`
		FutureToleranceS        int     `yaml:"future_tolerance_s"`
		ClockSkewFlagS          int     `yaml:"clock_skew_flag_s"`
	} `yaml:"tracking"`
	// Payments gates the Paddle sandbox money paths (B5). Paddle's rules ban
	// physical goods, marketplaces, and wallet balances, so the sandbox
	// provider is the only supported value; anything else disables top-ups
	// and card pay (sandbox-only guard).
	Payments struct {
		Provider    string `yaml:"provider"`
		SandboxOnly bool   `yaml:"sandbox_only"`
	} `yaml:"payments"`
	DatabaseURL string `yaml:"-"`
	JWTSecret   string `yaml:"-"`
	// PaddleWebhookSecret signs Paddle webhooks (HMAC-SHA256); the webhook
	// refuses everything while it is empty.
	PaddleWebhookSecret string `yaml:"-"`
	// IDEncKey seals courier ID numbers (AES-GCM). Env-only; when set it
	// replaces the JWT-secret-derived key for new seals. Rotation-safe:
	// sealed values are write-only (dup detection uses the hash), so old
	// rows stay opaque and new rows use the new key with no migration.
	IDEncKey  string `yaml:"-"`
	UploadDir string `yaml:"-"`
	SMTPHost  string `yaml:"-"`
	SMTPPort  string `yaml:"-"`
	// SMTPUser/Password/From wire Brevo SMTP (smtp-relay.brevo.com:587)
	// in prod; empty user keeps the Mailpit/no-auth dev path. Env-only,
	// never in config.yaml, never in API responses.
	SMTPUser     string `yaml:"-"`
	SMTPPassword string `yaml:"-"`
	SMTPFrom     string `yaml:"-"`
	// VAPID holds the Web Push key pair + contact. Env wins; when empty
	// the server falls back to the DB-generated pair in app_secrets
	// (dev continuity). Env-only.
	VAPIDPublicKey  string `yaml:"-"`
	VAPIDPrivateKey string `yaml:"-"`
	VAPIDSubject    string `yaml:"-"`
	// Paddle sandbox live wiring (plan §11). Webhook secret gates the
	// webhook; API key + env + client token document the sandbox app.
	// The public webhook URL is derived from Server.PublicBaseURL +
	// /v1/webhooks/paddle (see PaddleWebhookURL). Env-only.
	PaddleAPIKey      string `yaml:"-"`
	PaddleEnv         string `yaml:"-"`
	PaddleClientToken string `yaml:"-"`
	// R2 holds Cloudflare R2 (S3-compatible) wiring. When Endpoint is
	// empty the server uses the local UploadDir fallback (dev/tests);
	// when set, presign serves R2 presigned URLs: public bucket for
	// menus/avatars, private bucket for IDs/selfie/proof/agreements
	// with 5-min expiry. Env-only, never in API responses.
	R2Endpoint      string `yaml:"-"`
	R2AccessKey     string `yaml:"-"`
	R2SecretKey     string `yaml:"-"`
	R2PublicBucket  string `yaml:"-"`
	R2PrivateBucket string `yaml:"-"`
	R2PublicBaseURL string `yaml:"-"`
}

// Load reads config.yaml (if present) then applies env overrides.
func Load() (*Config, error) {
	c := &Config{}
	c.Server.Addr = ":8080"
	c.Server.DemoMode = true
	c.Auth.AccessTTLSeconds = 900
	c.Auth.RefreshTTLSeconds = 2592000
	c.Order.MerchantAcceptWindowS = 180
	c.Order.WindowMinMinutes = 30
	c.Order.WindowMaxMinutes = 60
	c.Health.WhoWeeklyActiveMin = 150
	c.Health.DailyActiveCapMin = 180
	c.Payments.Provider = "paddle_sandbox"
	c.Payments.SandboxOnly = true
	c.Fitness.RunnerDistanceM = 2000
	c.Fitness.RunnerMovingLimitS = 900
	c.Fitness.BikerDistanceM = 5000
	c.Fitness.BikerMovingLimitS = 1200
	c.Fitness.ElapsedCapMultiplier = 2
	c.Qualification.RetryAfterS = 3600
	c.Qualification.MaxAttemptsPerWeek = 3
	c.Qualification.MaxGapS = 60
	c.Qualification.CheckpointPhotos = 1
	c.Tracking.MaxAccuracyM = 30
	c.Tracking.RunnerMaxSpeedKmh = 25
	c.Tracking.BikerMaxSpeedKmh = 50
	c.Tracking.MinMovingSpeedMps = 0.5
	c.Tracking.SegmentMaxGapS = 30
	c.Tracking.RunnerActiveMinSpeedKmh = 5
	c.Tracking.BikerActiveMinSpeedKmh = 10
	c.Tracking.StaleAfterS = 60
	c.Tracking.AutoEndAfterS = 600
	c.Tracking.FutureToleranceS = 30
	c.Tracking.ClockSkewFlagS = 30
	c.Dispatch.RunnerCorridorM = 400
	c.Dispatch.BikerCorridorM = 800
	c.Dispatch.RunnerMaxToPickupM = 1500
	c.Dispatch.BikerMaxToPickupM = 3000
	c.Dispatch.RunnerMaxTripM = 3000
	c.Dispatch.BikerMaxTripM = 7000
	c.Dispatch.RunnerSizes = []string{"S", "M"}
	c.Dispatch.BikerSizes = []string{"S", "M", "L"}
	c.Dispatch.RunnerPlanKmh = 9
	c.Dispatch.BikerPlanKmh = 16
	c.Dispatch.Circuity = 1.3
	c.Dispatch.OfferWindowS = 30
	c.Dispatch.BroadcastWindowS = 60
	c.Dispatch.CascadeSize = 3
	c.Dispatch.SearchS = 240
	c.Dispatch.StaffS = 180
	c.Dispatch.RunnerMaxCarryS = 1500
	c.Dispatch.BikerMaxCarryS = 1800
	c.Dispatch.WFit = 1.5
	c.Dispatch.WFoodWait = 1.0
	c.Dispatch.WRating = 0.6
	c.Dispatch.WIdle = 0.2
	c.Dispatch.HeadingPenalty = 0.5
	c.Dispatch.DetourRefreshM = 150
	path := env("TF_CONFIG", "config.yaml")
	if b, err := os.ReadFile(path); err == nil {
		// map nested keys manually via generic yaml to keep struct simple
		var raw struct {
			Server struct {
				Addr       string `yaml:"addr"`
				DemoMode   bool   `yaml:"demo_mode"`
				PublicBase string `yaml:"public_base_url"`
			} `yaml:"server"`
			Auth struct {
				Access  int `yaml:"access_ttl_seconds"`
				Refresh int `yaml:"refresh_ttl_seconds"`
			} `yaml:"auth"`
			Order struct {
				AcceptWindow int `yaml:"merchant_accept_window_s"`
				WinMin       int `yaml:"window_min_minutes"`
				WinMax       int `yaml:"window_max_minutes"`
			} `yaml:"order"`
			Health struct {
				WhoMin int `yaml:"who_weekly_active_min"`
				DayCap int `yaml:"daily_active_cap_min"`
			} `yaml:"health"`
			Payments struct {
				Provider string `yaml:"provider"`
				Sandbox  bool   `yaml:"sandbox_only"`
			} `yaml:"payments"`
			AI struct {
				BaseURL     string `yaml:"base_url"`
				Spark       string `yaml:"spark_model"`
				Contributor string `yaml:"contributor_model"`
				Transcribe  string `yaml:"transcribe_model"`
				SAM         string `yaml:"sam_model"`
			} `yaml:"ai"`
			Fitness struct {
				RD float64 `yaml:"runner_distance_m"`
				BD float64 `yaml:"biker_distance_m"`
				RL int     `yaml:"runner_moving_limit_s"`
				BL int     `yaml:"biker_moving_limit_s"`
				EC int     `yaml:"elapsed_cap_multiplier"`
			} `yaml:"fitness"`
			Qualification struct {
				RetryAfterS int `yaml:"retry_after_s"`
				MaxPerWeek  int `yaml:"max_attempts_per_week"`
				MaxGapS     int `yaml:"max_gap_s"`
				Checkpoints int `yaml:"checkpoint_photos"`
			} `yaml:"qualification"`
			Tracking struct {
				MaxAcc        float64 `yaml:"max_accuracy_m"`
				RunMaxKmh     float64 `yaml:"runner_max_speed_kmh"`
				BikeMaxKmh    float64 `yaml:"biker_max_speed_kmh"`
				MinMovingMps  float64 `yaml:"min_moving_speed_mps"`
				SegMaxGapS    int     `yaml:"segment_max_gap_s"`
				RunActiveKmh  float64 `yaml:"runner_active_min_speed_kmh"`
				BikeActiveKmh float64 `yaml:"biker_active_min_speed_kmh"`
				StaleAfterS   int     `yaml:"stale_after_s"`
				AutoEndAfterS int     `yaml:"auto_end_after_s"`
				FutureTolS    int     `yaml:"future_tolerance_s"`
				SkewFlagS     int     `yaml:"clock_skew_flag_s"`
			} `yaml:"tracking"`
			Dispatch struct {
				RunCorr    float64  `yaml:"runner_corridor_m"`
				BikeCorr   float64  `yaml:"biker_corridor_m"`
				RunToPick  float64  `yaml:"runner_max_to_pickup_m"`
				BikeToPick float64  `yaml:"biker_max_to_pickup_m"`
				RunTrip    float64  `yaml:"runner_max_trip_m"`
				BikeTrip   float64  `yaml:"biker_max_trip_m"`
				RunSizes   []string `yaml:"runner_sizes"`
				BikeSizes  []string `yaml:"biker_sizes"`
				RunPlan    float64  `yaml:"runner_plan_kmh"`
				BikePlan   float64  `yaml:"biker_plan_kmh"`
				Circuity   float64  `yaml:"circuity"`
				OfferS     int      `yaml:"offer_window_s"`
				BroadcastS int      `yaml:"broadcast_window_s"`
				CascN      int      `yaml:"cascade_size"`
				SearchS    int      `yaml:"courier_search_s"`
				StaffS     int      `yaml:"staff_search_s"`
				RunCarryS  int      `yaml:"runner_max_carry_s"`
				BikeCarryS int      `yaml:"biker_max_carry_s"`
				WFit       float64  `yaml:"w_fit"`
				WFood      float64  `yaml:"w_food_wait"`
				WRate      float64  `yaml:"w_rating"`
				WIdle      float64  `yaml:"w_idle"`
				HeadPen    float64  `yaml:"heading_penalty"`
				DetourM    float64  `yaml:"detour_refresh_m"`
			} `yaml:"dispatch"`
		}
		if err := yaml.Unmarshal(b, &raw); err != nil {
			return nil, err
		}
		if raw.Server.Addr != "" {
			c.Server.Addr = raw.Server.Addr
		}
		c.Server.DemoMode = raw.Server.DemoMode
		if raw.Server.PublicBase != "" {
			c.Server.PublicBaseURL = raw.Server.PublicBase
		}
		if raw.Auth.Access > 0 {
			c.Auth.AccessTTLSeconds = raw.Auth.Access
		}
		if raw.Auth.Refresh > 0 {
			c.Auth.RefreshTTLSeconds = raw.Auth.Refresh
		}
		if raw.Order.AcceptWindow > 0 {
			c.Order.MerchantAcceptWindowS = raw.Order.AcceptWindow
		}
		if raw.Order.WinMin > 0 {
			c.Order.WindowMinMinutes = raw.Order.WinMin
		}
		if raw.Order.WinMax > 0 {
			c.Order.WindowMaxMinutes = raw.Order.WinMax
		}
		if raw.Health.WhoMin > 0 {
			c.Health.WhoWeeklyActiveMin = raw.Health.WhoMin
		}
		if raw.Health.DayCap > 0 {
			c.Health.DailyActiveCapMin = raw.Health.DayCap
		}
		if raw.Payments.Provider != "" {
			c.Payments.Provider = raw.Payments.Provider
		}
		c.Payments.SandboxOnly = raw.Payments.Sandbox
		if raw.AI.BaseURL != "" {
			c.AI.MetaBaseURL = raw.AI.BaseURL
		}
		if raw.AI.Spark != "" {
			c.AI.SparkModel = raw.AI.Spark
		}
		if raw.AI.Contributor != "" {
			c.AI.ContributorModel = raw.AI.Contributor
		}
		if raw.AI.Transcribe != "" {
			c.AI.TranscribeModel = raw.AI.Transcribe
		}
		if raw.AI.SAM != "" {
			c.AI.SAMModel = raw.AI.SAM
		}
		if raw.Fitness.RD > 0 {
			c.Fitness.RunnerDistanceM = raw.Fitness.RD
		}
		if raw.Fitness.BD > 0 {
			c.Fitness.BikerDistanceM = raw.Fitness.BD
		}
		if raw.Fitness.RL > 0 {
			c.Fitness.RunnerMovingLimitS = raw.Fitness.RL
		}
		if raw.Fitness.BL > 0 {
			c.Fitness.BikerMovingLimitS = raw.Fitness.BL
		}
		if raw.Fitness.EC > 0 {
			c.Fitness.ElapsedCapMultiplier = raw.Fitness.EC
		}
		if raw.Qualification.RetryAfterS > 0 {
			c.Qualification.RetryAfterS = raw.Qualification.RetryAfterS
		}
		if raw.Qualification.MaxPerWeek > 0 {
			c.Qualification.MaxAttemptsPerWeek = raw.Qualification.MaxPerWeek
		}
		if raw.Qualification.MaxGapS > 0 {
			c.Qualification.MaxGapS = raw.Qualification.MaxGapS
		}
		if raw.Qualification.Checkpoints > 0 {
			c.Qualification.CheckpointPhotos = raw.Qualification.Checkpoints
		}
		if raw.Tracking.MaxAcc > 0 {
			c.Tracking.MaxAccuracyM = raw.Tracking.MaxAcc
		}
		if raw.Tracking.RunMaxKmh > 0 {
			c.Tracking.RunnerMaxSpeedKmh = raw.Tracking.RunMaxKmh
		}
		if raw.Tracking.BikeMaxKmh > 0 {
			c.Tracking.BikerMaxSpeedKmh = raw.Tracking.BikeMaxKmh
		}
		if raw.Tracking.MinMovingMps > 0 {
			c.Tracking.MinMovingSpeedMps = raw.Tracking.MinMovingMps
		}
		if raw.Tracking.SegMaxGapS > 0 {
			c.Tracking.SegmentMaxGapS = raw.Tracking.SegMaxGapS
		}
		if raw.Tracking.RunActiveKmh > 0 {
			c.Tracking.RunnerActiveMinSpeedKmh = raw.Tracking.RunActiveKmh
		}
		if raw.Tracking.BikeActiveKmh > 0 {
			c.Tracking.BikerActiveMinSpeedKmh = raw.Tracking.BikeActiveKmh
		}
		if raw.Tracking.StaleAfterS > 0 {
			c.Tracking.StaleAfterS = raw.Tracking.StaleAfterS
		}
		if raw.Tracking.AutoEndAfterS > 0 {
			c.Tracking.AutoEndAfterS = raw.Tracking.AutoEndAfterS
		}
		if raw.Tracking.FutureTolS > 0 {
			c.Tracking.FutureToleranceS = raw.Tracking.FutureTolS
		}
		if raw.Tracking.SkewFlagS > 0 {
			c.Tracking.ClockSkewFlagS = raw.Tracking.SkewFlagS
		}
		d := raw.Dispatch
		if d.RunCorr > 0 {
			c.Dispatch.RunnerCorridorM = d.RunCorr
		}
		if d.BikeCorr > 0 {
			c.Dispatch.BikerCorridorM = d.BikeCorr
		}
		if d.RunToPick > 0 {
			c.Dispatch.RunnerMaxToPickupM = d.RunToPick
		}
		if d.BikeToPick > 0 {
			c.Dispatch.BikerMaxToPickupM = d.BikeToPick
		}
		if d.RunTrip > 0 {
			c.Dispatch.RunnerMaxTripM = d.RunTrip
		}
		if d.BikeTrip > 0 {
			c.Dispatch.BikerMaxTripM = d.BikeTrip
		}
		if len(d.RunSizes) > 0 {
			c.Dispatch.RunnerSizes = d.RunSizes
		}
		if len(d.BikeSizes) > 0 {
			c.Dispatch.BikerSizes = d.BikeSizes
		}
		if d.RunPlan > 0 {
			c.Dispatch.RunnerPlanKmh = d.RunPlan
		}
		if d.BikePlan > 0 {
			c.Dispatch.BikerPlanKmh = d.BikePlan
		}
		if d.Circuity > 0 {
			c.Dispatch.Circuity = d.Circuity
		}
		if d.OfferS > 0 {
			c.Dispatch.OfferWindowS = d.OfferS
		}
		if d.BroadcastS > 0 {
			c.Dispatch.BroadcastWindowS = d.BroadcastS
		}
		if d.CascN > 0 {
			c.Dispatch.CascadeSize = d.CascN
		}
		if d.SearchS > 0 {
			c.Dispatch.SearchS = d.SearchS
		}
		if d.StaffS > 0 {
			c.Dispatch.StaffS = d.StaffS
		}
		if d.RunCarryS > 0 {
			c.Dispatch.RunnerMaxCarryS = d.RunCarryS
		}
		if d.BikeCarryS > 0 {
			c.Dispatch.BikerMaxCarryS = d.BikeCarryS
		}
		if d.WFit > 0 {
			c.Dispatch.WFit = d.WFit
		}
		if d.WFood > 0 {
			c.Dispatch.WFoodWait = d.WFood
		}
		if d.WRate > 0 {
			c.Dispatch.WRating = d.WRate
		}
		if d.WIdle > 0 {
			c.Dispatch.WIdle = d.WIdle
		}
		if d.HeadPen > 0 {
			c.Dispatch.HeadingPenalty = d.HeadPen
		}
		if d.DetourM > 0 {
			c.Dispatch.DetourRefreshM = d.DetourM
		}
	}
	c.Payments.Provider = env("TF_PAYMENTS_PROVIDER", c.Payments.Provider)
	if c.Payments.Provider == "" {
		c.Payments.Provider = "paddle_sandbox"
	}
	c.DatabaseURL = env("DATABASE_URL", "postgres://Trackfud:Trackfud@localhost:5432/Trackfud?sslmode=disable")
	c.JWTSecret = env("TF_JWT_SECRET", "dev-only-change-me-32chars-minimum!!")
	if len(c.JWTSecret) < 32 {
		return nil, fmt.Errorf("TF_JWT_SECRET must be at least 32 chars")
	}
	c.IDEncKey = env("TF_IDENC_KEY", "")
	c.PaddleWebhookSecret = env("TF_PADDLE_WEBHOOK_SECRET", "")
	c.PaddleAPIKey = env("TF_PADDLE_API_KEY", "")
	c.PaddleEnv = env("TF_PADDLE_ENV", "sandbox")
	c.PaddleClientToken = env("TF_PADDLE_CLIENT_TOKEN", "")
	c.UploadDir = env("TF_UPLOAD_DIR", "data/uploads")
	c.SMTPHost = env("TF_SMTP_HOST", "")
	c.SMTPPort = env("TF_SMTP_PORT", "1025")
	c.SMTPUser = env("TF_SMTP_USER", "")
	c.SMTPPassword = env("TF_SMTP_PASSWORD", "")
	c.SMTPFrom = env("TF_SMTP_FROM", "no-reply@Trackfud.local")
	c.VAPIDPublicKey = env("TF_VAPID_PUBLIC_KEY", "")
	c.VAPIDPrivateKey = env("TF_VAPID_PRIVATE_KEY", "")
	c.VAPIDSubject = env("TF_VAPID_SUBJECT", "mailto:demo@Trackfud.local")
	if err := checkVAPIDPair(c.VAPIDPublicKey, c.VAPIDPrivateKey); err != nil {
		return nil, err
	}
	c.R2Endpoint = env("TF_R2_ENDPOINT", "")
	c.R2AccessKey = env("TF_R2_ACCESS_KEY", "")
	c.R2SecretKey = env("TF_R2_SECRET_KEY", "")
	c.R2PublicBucket = env("TF_R2_PUBLIC_BUCKET", "")
	c.R2PrivateBucket = env("TF_R2_PRIVATE_BUCKET", "")
	c.R2PublicBaseURL = env("TF_R2_PUBLIC_URL", "")
	c.Maps.APIKey = env("TF_GOOGLE_MAPS_KEY", "")
	c.AI.MetaAPIKey = env("TF_META_API_KEY", "")
	c.AI.MetaBaseURL = env("TF_META_BASE_URL", c.AI.MetaBaseURL)
	if c.AI.MetaBaseURL == "" {
		c.AI.MetaBaseURL = "https://api.meta.ai/v1"
	}
	// Modal proxy-token pair (wk-/ws-). Env-only; never commit these.
	c.AI.ModalKey = env("TF_MODAL_KEY", "")
	c.AI.ModalSecret = env("TF_MODAL_SECRET", "")
	// Env wins over config.yaml; hardcoded ids are the last resort.
	c.AI.SparkModel = env("TF_META_SPARK_MODEL", c.AI.SparkModel)
	if c.AI.SparkModel == "" {
		c.AI.SparkModel = "muse-spark-1.3"
	}
	c.AI.ContributorModel = env("TF_META_CONTRIBUTOR_MODEL", c.AI.ContributorModel)
	if c.AI.ContributorModel == "" {
		c.AI.ContributorModel = "muse-spark-1.3-contributor"
	}
	c.AI.TranscribeModel = env("TF_META_TRANSCRIBE_MODEL", c.AI.TranscribeModel)
	if c.AI.TranscribeModel == "" {
		c.AI.TranscribeModel = "muse-voice-transcribe-1.0"
	}
	c.AI.SAMModel = env("TF_META_SAM_MODEL", c.AI.SAMModel)
	if c.AI.SAMModel == "" {
		c.AI.SAMModel = "sam-3.1"
	}
	if v := os.Getenv("TF_ADDR"); v != "" {
		c.Server.Addr = v
	}
	if v := os.Getenv("TF_PUBLIC_BASE_URL"); v != "" {
		c.Server.PublicBaseURL = v
	}
	if c.Server.PublicBaseURL == "" {
		c.Server.PublicBaseURL = "http://localhost:8000"
	}
	// APP_DEVELOPMENT is the canonical environment switch: "production"
	// means production mode (no demo shortcuts — no demo-login, no
	// dev simulate-paid). local/development/demo mean local/demo mode
	// for now. Precedence: explicit TF_DEMO_MODE wins when set (compat
	// with existing deployments), then an explicit APP_DEVELOPMENT,
	// otherwise the config.yaml value stands.
	if v, ok := os.LookupEnv("TF_DEMO_MODE"); ok && strings.TrimSpace(v) != "" {
		c.Server.DemoMode, _ = strconv.ParseBool(v)
	} else if dev := strings.TrimSpace(os.Getenv("APP_DEVELOPMENT")); dev != "" {
		c.Server.DemoMode = !strings.EqualFold(dev, "production")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// checkVAPIDPair fails fast on a misconfigured Web Push pair so a typo'd or
// hand-invented key breaks the boot log instead of silently breaking push
// delivery. Empty pair is allowed: the server falls back to the DB-generated
// dev pair in app_secrets. A set pair must be one matched P-256 pair from a
// single `web-push generate-vapid-keys` run (base64url, no padding:
// 43-char private = 32 bytes, 87-char public = 65-byte uncompressed point).
func checkVAPIDPair(pub, priv string) error {
	if pub == "" && priv == "" {
		return nil
	}
	if pub == "" || priv == "" {
		return fmt.Errorf("invalid VAPID config: set both TF_VAPID_PUBLIC_KEY and TF_VAPID_PRIVATE_KEY, or neither (empty falls back to the DB dev pair)")
	}
	privBytes, err := base64.RawURLEncoding.DecodeString(priv)
	if err != nil || len(privBytes) != 32 {
		return fmt.Errorf("invalid TF_VAPID_PRIVATE_KEY: must be the 43-char base64url private key from generate-vapid-keys (got %d chars) — never hand-type it", len(priv))
	}
	pubBytes, err := base64.RawURLEncoding.DecodeString(pub)
	if err != nil || len(pubBytes) != 65 || pubBytes[0] != 0x04 {
		return fmt.Errorf("invalid TF_VAPID_PUBLIC_KEY: must be the 87-char base64url public key from generate-vapid-keys (got %d chars) — never hand-type it", len(pub))
	}
	x, y := elliptic.P256().ScalarBaseMult(privBytes)
	derived := elliptic.Marshal(elliptic.P256(), x, y)
	if subtle.ConstantTimeCompare(derived, pubBytes) != 1 {
		return fmt.Errorf("invalid VAPID pair: TF_VAPID_PRIVATE_KEY does not derive TF_VAPID_PUBLIC_KEY — paste both lines from the SAME generate-vapid-keys output")
	}
	return nil
}

// R2Configured reports whether live R2 presigning is possible: endpoint +
// credentials + both buckets must be present. Otherwise callers use the
// local UploadDir fallback (dev/tests).
func (c *Config) R2Configured() bool {
	return c.R2Endpoint != "" && c.R2AccessKey != "" && c.R2SecretKey != "" &&
		c.R2PublicBucket != "" && c.R2PrivateBucket != ""
}

// R2BucketFor maps the presign bucket contract to the live bucket name:
// "private" (IDs/selfie/proof/agreements) goes to the private bucket,
// everything else (menus/avatars) to the public bucket.
func (c *Config) R2BucketFor(bucket string) string {
	if bucket == "private" {
		return c.R2PrivateBucket
	}
	return c.R2PublicBucket
}

// PaddleWebhookURL is the public URL Paddle calls: base + fixed path.
// Configure TF_PUBLIC_BASE_URL to the gateway origin in prod.
func (c *Config) PaddleWebhookURL() string {
	base := strings.TrimRight(c.Server.PublicBaseURL, "/")
	if base == "" {
		base = "http://localhost:8000"
	}
	return base + "/api/v1/webhooks/paddle"
}
