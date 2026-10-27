// Package maps wraps the Google Routes API for courier ETAs (plan §9).
//
// Calls go out as plain HTTPS from the Go server with a tight field mask so
// trips stay on the cheaper Essentials SKU. Travel mode is WALK for runners
// and BICYCLE for bikers; both are beta, so every ETA response carries the
// warning Google requires. When no API key is configured the planner falls
// back to the dispatch planning speed × circuity estimate — the demo runs
// fully offline.
package maps

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// BetaWarning is the disclaimer Google requires on walking/cycling routes.
const BetaWarning = "Walking/cycling routes are in beta and may miss sidewalks or bike paths."

// FieldMask keeps ComputeRoutes on the Essentials SKU.
const FieldMask = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"

const endpoint = "https://routes.googleapis.com/directions/v2:computeRoutes"

// RouteResult is one ETA answer in API units (seconds, meters).
type RouteResult struct {
	DurationS int     `json:"duration_s"`
	DistanceM float64 `json:"distance_m"`
	Polyline  string  `json:"polyline"`
	Source    string  `json:"source"` // "routes_api" or "estimate"
}

// TravelMode maps a courier mode to the Routes API travel mode.
func TravelMode(courierMode string) string {
	if courierMode == "biker" {
		return "BICYCLE"
	}
	return "WALK"
}

// Estimate plans with straight-line distance × circuity at the planning
// speed. It is the offline fallback and the pre-assign planner.
func Estimate(distanceM, planKmh, circuity float64) RouteResult {
	speed := planKmh / 3.6
	if speed <= 0 {
		speed = 2.5
	}
	routed := distanceM * circuity
	return RouteResult{DurationS: int(routed / speed), DistanceM: routed, Source: "estimate"}
}

// ComputeRoute asks the Routes API for one route. Call it only on assign,
// on pickup, and on a 150 m+ detour (plan §9) — never per GPS point.
func ComputeRoute(ctx context.Context, apiKey string, oLat, oLng, dLat, dLng float64, courierMode string) (RouteResult, error) {
	body, _ := json.Marshal(map[string]any{
		"origin":          map[string]any{"location": map[string]any{"latLng": map[string]any{"latitude": oLat, "longitude": oLng}}},
		"destination":     map[string]any{"location": map[string]any{"latLng": map[string]any{"latitude": dLat, "longitude": dLng}}},
		"travelMode":      TravelMode(courierMode),
		"units":           "METRIC",
		"polylineQuality": "OVERVIEW",
	})
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return RouteResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", FieldMask)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return RouteResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return RouteResult{}, fmt.Errorf("maps: routes api status %d", resp.StatusCode)
	}
	var out struct {
		Routes []struct {
			DistanceM int    `json:"distanceMeters"`
			Duration  string `json:"duration"`
			Polyline  struct {
				Encoded string `json:"encodedPolyline"`
			} `json:"polyline"`
		} `json:"routes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return RouteResult{}, err
	}
	if len(out.Routes) == 0 {
		return RouteResult{}, fmt.Errorf("maps: no routes returned")
	}
	r := out.Routes[0]
	return RouteResult{
		DurationS: parseDurationS(r.Duration),
		DistanceM: float64(r.DistanceM),
		Polyline:  r.Polyline.Encoded,
		Source:    "routes_api",
	}, nil
}

// parseDurationS reads the "123s" duration shape the Routes API returns.
func parseDurationS(s string) int {
	n, err := strconv.Atoi(strings.TrimSuffix(s, "s"))
	if err != nil || n < 0 {
		return 0
	}
	return n
}
