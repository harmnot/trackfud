// Package config loads Trackfud configuration from YAML plus env overrides.
package config

import (
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

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
	Dispatch struct {
		RunnerCorridorM, BikerCorridorM       float64
		RunnerMaxToPickupM, BikerMaxToPickupM float64
		RunnerMaxTripM, BikerMaxTripM         float64
		RunnerSizes, BikerSizes               []string
		RunnerSpill, BikerSpill               []string
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
	} `yaml:"dispatch"`
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
	UploadDir           string `yaml:"-"`
	SMTPHost            string `yaml:"-"`
	SMTPPort            string `yaml:"-"`
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
	c.Dispatch.RunnerSpill = []string{"low"}
	c.Dispatch.BikerSpill = []string{"low", "medium"}
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
				RunSpill   []string `yaml:"runner_spill"`
				BikeSpill  []string `yaml:"biker_spill"`
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
		if len(d.RunSpill) > 0 {
			c.Dispatch.RunnerSpill = d.RunSpill
		}
		if len(d.BikeSpill) > 0 {
			c.Dispatch.BikerSpill = d.BikeSpill
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
	c.PaddleWebhookSecret = env("TF_PADDLE_WEBHOOK_SECRET", "")
	c.UploadDir = env("TF_UPLOAD_DIR", "data/uploads")
	c.SMTPHost = env("TF_SMTP_HOST", "")
	c.SMTPPort = env("TF_SMTP_PORT", "1025")
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
	if v := os.Getenv("TF_DEMO_MODE"); v != "" {
		c.Server.DemoMode, _ = strconv.ParseBool(v)
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
