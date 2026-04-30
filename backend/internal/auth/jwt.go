// Package auth validates Kimbu JWTs on WebSocket upgrade.
// It supports both RS256 (production, via JWKS) and HS256 (local dev, via JWT_SECRET).
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims mirrors Kimbu's JwtPayload.
type Claims struct {
	AppID    string   `json:"app_id"`
	Roles    []string `json:"roles"`
	DeviceID string   `json:"device_id"`
	jwt.RegisteredClaims
}

// Validator verifies Kimbu JWTs.
type Validator struct {
	jwksURL   string
	hmacKey   []byte // fallback for HS256 local dev

	mu      sync.RWMutex
	rsaKeys map[string]*rsa.PublicKey // kid → key
	fetched time.Time
}

const jwksCacheTTL = 5 * time.Minute

func NewValidator(jwksURL string, hmacSecret string) *Validator {
	v := &Validator{
		jwksURL: jwksURL,
		rsaKeys: make(map[string]*rsa.PublicKey),
	}
	if hmacSecret != "" {
		v.hmacKey = []byte(hmacSecret)
	}
	return v
}

// Validate parses and verifies a JWT. Returns claims on success.
func (v *Validator) Validate(ctx context.Context, tokenStr string) (*Claims, error) {
	claims := &Claims{}

	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		switch t.Method.Alg() {
		case "RS256":
			kid, _ := t.Header["kid"].(string)
			key, err := v.rsaKey(ctx, kid)
			if err != nil {
				return nil, fmt.Errorf("jwks: %w", err)
			}
			return key, nil
		case "HS256":
			if v.hmacKey == nil {
				return nil, fmt.Errorf("HS256 token but no JWT_SECRET configured")
			}
			return v.hmacKey, nil
		default:
			return nil, fmt.Errorf("unsupported algorithm: %s", t.Method.Alg())
		}
	})

	return claims, err
}

// TimeUntilExpiry returns seconds until the token expires.
func TimeUntilExpiry(claims *Claims) time.Duration {
	if claims.ExpiresAt == nil {
		return 0
	}
	return time.Until(claims.ExpiresAt.Time)
}

// rsaKey returns the RSA public key for a given kid, refreshing the JWKS if needed.
// If kid is empty, returns the only key in the JWKS (single-key issuers omit kid).
func (v *Validator) rsaKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	key, ok := v.rsaKeys[kid]
	stale := time.Since(v.fetched) > jwksCacheTTL
	v.mu.RUnlock()

	if ok && !stale {
		return key, nil
	}

	if err := v.fetchJWKS(ctx); err != nil {
		if ok {
			slog.Warn("jwks refresh failed, using cached key", "err", err)
			return key, nil
		}
		return nil, err
	}

	v.mu.RLock()
	defer v.mu.RUnlock()
	if key, ok = v.rsaKeys[kid]; ok {
		return key, nil
	}
	// kid absent or not matched — use the sole key if there is exactly one.
	if kid == "" && len(v.rsaKeys) == 1 {
		for _, k := range v.rsaKeys {
			return k, nil
		}
	}
	return nil, fmt.Errorf("kid %q not found in JWKS", kid)
}

type jwksResponse struct {
	Keys []struct {
		Kid string `json:"kid"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func (v *Validator) fetchJWKS(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var jwks jwksResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		return err
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		pub, err := jwkToRSA(k.N, k.E)
		if err != nil {
			slog.Warn("skipping malformed JWK", "kid", k.Kid, "err", err)
			continue
		}
		keys[k.Kid] = pub
	}

	v.mu.Lock()
	v.rsaKeys = keys
	v.fetched = time.Now()
	v.mu.Unlock()

	slog.Info("jwks refreshed", "keys", len(keys))
	return nil
}

func jwkToRSA(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}

	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}
