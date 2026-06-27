// Package crypto provides AES-GCM helpers used to encrypt sensitive
// per-user fields (WhatsApp access tokens, verify tokens) at rest.
//
// The key is a 32-byte secret loaded from BC_FIELD_ENC_KEY. Each Encrypt
// call generates a fresh random 12-byte nonce, so the same plaintext
// encrypted twice produces different ciphertexts — required by AES-GCM.
//
// Ciphertext and nonce are returned as separate byte slices so the
// caller can store them in distinct BYTEA columns. The nonce does not
// need to be secret; the key does.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
)

// ErrKeyLength is returned when the configured key is not exactly 32 bytes.
var ErrKeyLength = errors.New("crypto: key must be 32 bytes (AES-256)")

// NewAEAD returns a cipher.AEAD for the given key. Validates length.
func NewAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("%w (got %d)", ErrKeyLength, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Encrypt seals plaintext with a fresh random nonce. The returned nonce
// must be stored alongside the ciphertext and passed back to Decrypt.
//
// On a length/key error it returns a wrapped error so the caller can
// surface a clear message in the API response.
func Encrypt(key, plaintext []byte) (ciphertext, nonce []byte, err error) {
	aead, err := NewAEAD(key)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("crypto: read nonce: %w", err)
	}
	ciphertext = aead.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

// Decrypt opens ciphertext using the supplied nonce. Returns an error if
// the key length is wrong, the nonce length is wrong, or the
// authentication tag fails (i.e. the ciphertext was tampered with or
// encrypted with a different key).
func Decrypt(key, ciphertext, nonce []byte) ([]byte, error) {
	aead, err := NewAEAD(key)
	if err != nil {
		return nil, err
	}
	if len(nonce) != aead.NonceSize() {
		return nil, fmt.Errorf("crypto: nonce must be %d bytes (got %d)", aead.NonceSize(), len(nonce))
	}
	plain, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("crypto: decrypt failed (wrong key or tampered): %w", err)
	}
	return plain, nil
}
