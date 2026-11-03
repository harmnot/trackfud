package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Platform headers (X-TF-App): the API isolates platforms, so courier
// calls must say "courier" and the auto-merchant must say "merchant".
const (
	appCourier  = "courier"
	appMerchant = "merchant"
)

// loginBackoff spaces failed sign-ins: the API rate-limits /v1/auth/login
// per IP, and one bad account must not lock every bot out.
const loginBackoff = time.Minute

// maxResponseBytes bounds decoded API responses.
const maxResponseBytes = 1 << 20

// errLoginBackoff means a recent sign-in failed and the retry is waiting.
var errLoginBackoff = errors.New("login: waiting after a failed attempt")

// client is the JSON API client (base includes the gateway /api prefix).
type client struct {
	base string
	http *http.Client
}

// identity is the per-call platform header plus bearer token.
type identity struct{ app, token string }

// do sends one JSON request and decodes a 2xx body into out (if non-nil).
func (c *client) do(id identity, method, path string, body, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if id.token != "" {
		req.Header.Set("Authorization", "Bearer "+id.token)
	}
	req.Header.Set("X-TF-App", id.app)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return resp.StatusCode, err
	}
	if out != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 && len(b) > 0 {
		if err := json.Unmarshal(b, out); err != nil {
			return resp.StatusCode, fmt.Errorf("decode %s %s: %w", method, path, err)
		}
	}
	return resp.StatusCode, nil
}

// actor is one account signed in on one platform. Access tokens live 15
// minutes, so a 401 triggers one re-login and retry.
type actor struct {
	api       *client
	app       string
	email     string
	password  string
	token     string
	nextLogin time.Time
}

// login signs in on the actor's platform. A failure arms loginBackoff.
func (a *actor) login() error {
	if time.Now().Before(a.nextLogin) {
		return errLoginBackoff
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	code, err := a.api.do(identity{app: a.app}, http.MethodPost, "/v1/auth/login",
		map[string]any{"email": a.email, "password": a.password, "app": a.app}, &out)
	if err == nil && (code >= 300 || out.AccessToken == "") {
		err = fmt.Errorf("HTTP %d", code)
	}
	if err != nil {
		a.nextLogin = time.Now().Add(loginBackoff)
		return fmt.Errorf("login %s (%s): %w", a.email, a.app, err)
	}
	a.token = out.AccessToken
	return nil
}

// call sends one authenticated request as this actor.
func (a *actor) call(method, path string, body, out any) (int, error) {
	code, err := a.api.do(identity{a.app, a.token}, method, path, body, out)
	if err != nil || code != http.StatusUnauthorized {
		return code, err
	}
	if lerr := a.login(); lerr != nil {
		return code, nil
	}
	return a.api.do(identity{a.app, a.token}, method, path, body, out)
}
