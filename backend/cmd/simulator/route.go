package main

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// pt is a WGS84 position.
type pt struct{ lat, lng float64 }

// earthRadiusM matches the server's haversine (internal/app/fitness.go), so
// the distances and speeds the bots plan are the ones the API measures.
const earthRadiusM = 6371000.0

// metersPerDeg is the length of one degree of latitude on that sphere.
const metersPerDeg = earthRadiusM * math.Pi / 180

// Route shape rules.
const (
	// closedRouteM: a line whose ends are this close is a closed loop.
	closedRouteM = 30.0
	// minRouteM: shorter routes are rejected (bots would pace in place).
	minRouteM = 20.0
	// samePointM: consecutive vertices closer than this are one vertex.
	samePointM = 0.01
	// rejoinEpsM: closer than this to the cursor point counts as on-route.
	rejoinEpsM = 1.0
)

// distM returns the haversine distance between two points in meters.
func distM(a, b pt) float64 {
	dLat := (b.lat - a.lat) * math.Pi / 180
	dLng := (b.lng - a.lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.lat*math.Pi/180)*math.Cos(b.lat*math.Pi/180)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// lerp interpolates between a and b (accurate at route-segment scale).
func lerp(a, b pt, f float64) pt {
	return pt{a.lat + (b.lat-a.lat)*f, a.lng + (b.lng-a.lng)*f}
}

// moveToward steps from→to by meters in a straight line and returns the
// new point plus the distance still left to go.
func moveToward(from, to pt, meters float64) (pt, float64) {
	d := distM(from, to)
	if d <= meters || d == 0 {
		return to, 0
	}
	return lerp(from, to, meters/d), d - meters
}

// route is one polyline the bots cruise.
type route struct {
	name string
	mode string    // "runner", "biker", or "" (serves every mode)
	loop bool      // true: wrap end→start; false: out-and-back
	pts  []pt      // vertices; loop routes end on their first vertex
	cum  []float64 // meters from the start at each vertex
}

// newRoute validates a polyline. Repeated vertices collapse, and a loop
// that does not end where it starts gets its closing leg appended, so a
// bot walks back to the start instead of jumping there.
func newRoute(name, mode string, loop bool, in []pt) (*route, error) {
	pts := make([]pt, 0, len(in)+1)
	for _, p := range in {
		if len(pts) > 0 && distM(pts[len(pts)-1], p) < samePointM {
			continue
		}
		pts = append(pts, p)
	}
	if len(pts) < 2 {
		return nil, errors.New("route needs at least 2 distinct points")
	}
	if loop && distM(pts[0], pts[len(pts)-1]) >= samePointM {
		pts = append(pts, pts[0])
	}
	cum := make([]float64, len(pts))
	for i := 1; i < len(pts); i++ {
		cum[i] = cum[i-1] + distM(pts[i-1], pts[i])
	}
	if cum[len(cum)-1] < minRouteM {
		return nil, fmt.Errorf("route shorter than %.0f m", minRouteM)
	}
	return &route{name: name, mode: mode, loop: loop, pts: pts, cum: cum}, nil
}

// length is the route length in meters (closing leg included for loops).
func (r *route) length() float64 { return r.cum[len(r.cum)-1] }

// cursor is a position along a route.
type cursor struct {
	d   float64 // meters from the route start, in [0, length]
	dir float64 // +1 forward, -1 backward (out-and-back routes only)
}

// pointAt returns the position d meters along the route (clamped).
func (r *route) pointAt(d float64) pt {
	l := r.length()
	if d <= 0 {
		return r.pts[0]
	}
	if d >= l {
		return r.pts[len(r.pts)-1]
	}
	i := sort.SearchFloat64s(r.cum, d) // first vertex at or beyond d
	if i == 0 {
		return r.pts[0]
	}
	seg := r.cum[i] - r.cum[i-1]
	if seg <= 0 {
		return r.pts[i]
	}
	return lerp(r.pts[i-1], r.pts[i], (d-r.cum[i-1])/seg)
}

// advance moves a cursor meters along the route: loops wrap, open routes
// bounce at their ends (period 2×length, so long steps stay O(1)).
func (r *route) advance(c cursor, meters float64) cursor {
	l := r.length()
	if r.loop {
		d := math.Mod(c.d+meters, l)
		if d < 0 {
			d += l
		}
		return cursor{d: d, dir: 1}
	}
	u := c.d // unfolded position on the 2L out-and-back cycle
	if c.dir < 0 {
		u = 2*l - c.d
	}
	u = math.Mod(u+meters, 2*l)
	if u < 0 {
		u += 2 * l
	}
	if u <= l {
		return cursor{d: u, dir: 1}
	}
	return cursor{d: 2*l - u, dir: -1}
}

// nearest returns the cursor of the route point closest to p (projection
// onto each segment in a local metric plane around p).
func (r *route) nearest(p pt) cursor {
	best, bestD := math.Inf(1), 0.0
	for i := 0; i+1 < len(r.pts); i++ {
		ax, ay := toLocal(p, r.pts[i])
		bx, by := toLocal(p, r.pts[i+1])
		dx, dy := bx-ax, by-ay
		t := 0.0
		if l2 := dx*dx + dy*dy; l2 > 0 {
			t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/l2))
		}
		if d := math.Hypot(ax+t*dx, ay+t*dy); d < best {
			best, bestD = d, r.cum[i]+t*(r.cum[i+1]-r.cum[i])
		}
	}
	return cursor{d: bestD, dir: 1}
}

// toLocal projects q into meters east/north of origin.
func toLocal(origin, q pt) (x, y float64) {
	return (q.lng - origin.lng) * metersPerDeg * math.Cos(origin.lat*math.Pi/180),
		(q.lat - origin.lat) * metersPerDeg
}

// followRoute moves a bot meters from its true position p: when p is off
// the route (after a delivery, or a resumed session elsewhere) it first
// walks straight back to the cursor point, then spends the rest of the
// budget along the route. No hop is longer than meters.
func followRoute(r *route, c cursor, p pt, meters float64) (pt, cursor) {
	target := r.pointAt(c.d)
	if gap := distM(p, target); gap > rejoinEpsM {
		if gap >= meters {
			np, _ := moveToward(p, target, meters)
			return np, c
		}
		meters -= gap
	}
	c = r.advance(c, meters)
	return r.pointAt(c.d), c
}

// ---------- route sources ----------

// geoFeatureCollection is the --routes file shape (GeoJSON, RFC 7946).
type geoFeatureCollection struct {
	Type     string `json:"type"`
	Features []struct {
		Geometry *struct {
			Type        string          `json:"type"`
			Coordinates json.RawMessage `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Name string `json:"name"`
			Mode string `json:"mode"`
			Loop *bool  `json:"loop"`
		} `json:"properties"`
	} `json:"features"`
}

// parseRoutes reads a GeoJSON FeatureCollection of LineString features
// ([lng, lat] positions). properties.mode (runner|biker) limits a route to
// one mode (absent: every mode); properties.loop wraps end→start (absent:
// true when the line is closed, else out-and-back). Features with other
// geometry types are skipped; at least one LineString is required.
func parseRoutes(data []byte) ([]*route, error) {
	var fc geoFeatureCollection
	if err := json.Unmarshal(data, &fc); err != nil {
		return nil, fmt.Errorf("routes: %w", err)
	}
	if fc.Type != "FeatureCollection" {
		return nil, errors.New("routes: want a GeoJSON FeatureCollection")
	}
	out := []*route{}
	for i, f := range fc.Features {
		if f.Geometry == nil || f.Geometry.Type != "LineString" {
			continue
		}
		var coords [][]float64
		if err := json.Unmarshal(f.Geometry.Coordinates, &coords); err != nil {
			return nil, fmt.Errorf("routes: feature %d coordinates: %w", i, err)
		}
		pts := make([]pt, 0, len(coords))
		for j, c := range coords {
			if len(c) < 2 {
				return nil, fmt.Errorf("routes: feature %d position %d must be [lng, lat]", i, j)
			}
			lng, lat := c[0], c[1]
			if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
				return nil, fmt.Errorf("routes: feature %d position %d out of range", i, j)
			}
			pts = append(pts, pt{lat, lng})
		}
		mode := strings.ToLower(strings.TrimSpace(f.Properties.Mode))
		if mode != "" && mode != "runner" && mode != "biker" {
			return nil, fmt.Errorf("routes: feature %d mode %q must be runner or biker", i, f.Properties.Mode)
		}
		name := strings.TrimSpace(f.Properties.Name)
		if name == "" {
			name = fmt.Sprintf("route-%d", i+1)
		}
		loop := len(pts) > 2 && distM(pts[0], pts[len(pts)-1]) <= closedRouteM
		if f.Properties.Loop != nil {
			loop = *f.Properties.Loop
		}
		r, err := newRoute(name, mode, loop, pts)
		if err != nil {
			return nil, fmt.Errorf("routes: feature %d (%s): %w", i, name, err)
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return nil, errors.New("routes: no LineString features")
	}
	return out, nil
}

// parseGPX reads trkpt lat/lon points from a GPX document.
func parseGPX(data []byte) ([]pt, error) {
	var doc struct {
		Trk []struct {
			Seg []struct {
				Pt []struct {
					Lat float64 `xml:"lat,attr"`
					Lon float64 `xml:"lon,attr"`
				} `xml:"trkpt"`
			} `xml:"trkseg"`
		} `xml:"trk"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("gpx: %w", err)
	}
	var track []pt
	for _, t := range doc.Trk {
		for _, s := range t.Seg {
			for _, p := range s.Pt {
				track = append(track, pt{p.Lat, p.Lon})
			}
		}
	}
	if len(track) < 2 {
		return nil, errors.New("gpx: no trkpt points")
	}
	return track, nil
}

// cityLoop builds the default ~3.8 km wobbly loop around a demo city.
func cityLoop(city string) []pt {
	center := pt{-6.2088, 106.8456} // Jakarta demo merchants (Sudirman)
	if city == "london" {
		center = pt{51.5055, -0.0910}
	}
	track := make([]pt, 0, 24)
	for i := range 24 {
		a := 2 * math.Pi * float64(i) / 24
		// ~600 m radius with a wobble so it looks run, not drawn.
		r := 0.0055 * (1 + 0.15*math.Sin(3*a))
		track = append(track, pt{center.lat + r*math.Cos(a), center.lng + r*math.Sin(a)})
	}
	return track
}

// routesForMode returns the routes a mode may use: its own plus mode-less
// ones, or every route when none match.
func routesForMode(routes []*route, mode string) []*route {
	var match []*route
	for _, r := range routes {
		if r.mode == "" || r.mode == mode {
			match = append(match, r)
		}
	}
	if len(match) == 0 {
		return routes
	}
	return match
}

// assignRoutes picks each account's route round-robin within its mode's
// routes (see routesForMode).
func assignRoutes(accts []account, routes []*route) []*route {
	out := make([]*route, len(accts))
	next := map[string]int{}
	for i, a := range accts {
		pool := routesForMode(routes, a.Mode)
		out[i] = pool[next[a.Mode]%len(pool)]
		next[a.Mode]++
	}
	return out
}
