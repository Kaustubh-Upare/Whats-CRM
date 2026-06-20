package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const TokenTTL = 24 * time.Hour

type Claims struct {
	UserID int64  `json:"uid"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Name   string `json:"name"`
	jwt.RegisteredClaims
}

// HashPassword hashes `plain` with bcrypt at `cost`. Cost must be in [4, 31];
// callers should validate via config.Load before passing it in.
func HashPassword(plain string, cost int) (string, error) {
	if cost < bcrypt.MinCost {
		cost = bcrypt.DefaultCost
	}
	b, err := bcrypt.GenerateFromPassword([]byte(plain), cost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func CheckPassword(hash, plain string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
}

type Issuer struct {
	Secret   []byte
	Audience string // optional "aud" claim — empty disables the assertion
}

func NewIssuer(secret, audience string) *Issuer {
	return &Issuer{Secret: []byte(secret), Audience: audience}
}

func (i *Issuer) Issue(uid int64, email, role, name string) (string, error) {
	claims := Claims{
		UserID: uid, Email: email, Role: role, Name: name,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(TokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "whatsyitc-billingcomm",
			Subject:   email,
			Audience:  nilToAudience(i.Audience),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(i.Secret)
}

func (i *Issuer) Parse(s string) (*Claims, error) {
	t, err := jwt.ParseWithClaims(s, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("bad signing method")
		}
		return i.Secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !t.Valid {
		if err == nil {
			err = errors.New("token invalid")
		}
		return nil, err
	}
	c, ok := t.Claims.(*Claims)
	if !ok {
		return nil, errors.New("invalid claims")
	}
	if i.Audience != "" {
		if !audienceContains(c.Audience, i.Audience) {
			return nil, errors.New("invalid audience")
		}
	}
	return c, nil
}

func ExtractBearer(authHeader string) string {
	if authHeader == "" {
		return ""
	}
	return strings.TrimPrefix(authHeader, "Bearer ")
}

func nilToAudience(a string) jwt.ClaimStrings {
	if a == "" {
		return nil
	}
	return jwt.ClaimStrings{a}
}

func audienceContains(got jwt.ClaimStrings, want string) bool {
	for _, a := range got {
		if a == want {
			return true
		}
	}
	return false
}