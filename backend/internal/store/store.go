// Package store is the data access layer for the billingcomm service.
// All SQL lives here; handlers stay thin.
//
// Per-admin scoping
// -----------------
// Every read method that returns user-owned data takes an adminUserID
// argument and applies `WHERE ... AND t.admin_user_id = $N` (or
// `uploaded_by = $N` for batches, which already had a per-row owner).
// Every write that runs in a request context stamps admin_user_id from
// the JWT.
//
// Backwards-compat:
//   - admin_user_id is nullable on every table. Rows where it's NULL
//     are visible to every admin (preserves legacy data visibility
//     after migration 004).
//   - On the worker / webhook paths (no JWT context) we explicitly
//     resolve an admin id before any insert.
package store

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/whatsyitc/backend/internal/crypto"
	"github.com/whatsyitc/backend/internal/models"
)

type Store struct{ DB *pgxpool.Pool }

func New(db *pgxpool.Pool) *Store { return &Store{DB: db} }

// ---------- admin users ----------

func (s *Store) GetAdminByEmail(ctx context.Context, email string) (*models.AdminUser, error) {
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		SELECT id, email, password_hash, name, role, is_active,
		       google_id, avatar_url, oauth_provider, workspace_name,
		       created_at, last_login_at
		FROM bc_admin_users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive,
		&u.GoogleID, &u.AvatarURL, &u.OAuthProvider, &u.WorkspaceName,
		&u.CreatedAt, &u.LastLoginAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetAdminByGoogleID looks up an admin by their stable Google subject id.
// Returns (nil, nil) when no match — callers translate that to "create one".
func (s *Store) GetAdminByGoogleID(ctx context.Context, googleID string) (*models.AdminUser, error) {
	if googleID == "" {
		return nil, nil
	}
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		SELECT id, email, password_hash, name, role, is_active,
		       google_id, avatar_url, oauth_provider, workspace_name,
		       created_at, last_login_at
		FROM bc_admin_users WHERE google_id = $1
	`, googleID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive,
		&u.GoogleID, &u.AvatarURL, &u.OAuthProvider, &u.WorkspaceName,
		&u.CreatedAt, &u.LastLoginAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// CreateAdminFromGoogle inserts a new admin row keyed on google_id with
// no password (OAuth-only). Email is taken from Google's "email" claim
// and may collide with an existing password-only account — that's fine,
// we update the existing row instead (see UpsertAdminFromGoogle).
func (s *Store) CreateAdminFromGoogle(ctx context.Context, googleID, email, name, avatarURL string) (*models.AdminUser, error) {
	// Default workspace_name to "<name>'s workspace" so a fresh Google
	// user sees a sensible label without having to rename it manually.
	defaultWorkspace := name + "'s workspace"
	if name == "" {
		defaultWorkspace = "My Workspace"
	}
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_admin_users
			(email, password_hash, name, role, google_id, avatar_url, oauth_provider, workspace_name)
		VALUES ($1, NULL, $2, 'admin', $3, NULLIF($4,''), 'google', $5)
		RETURNING id, email, password_hash, name, role, is_active,
		          google_id, avatar_url, oauth_provider, workspace_name,
		          created_at, last_login_at
	`, email, name, googleID, avatarURL, defaultWorkspace).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive,
		&u.GoogleID, &u.AvatarURL, &u.OAuthProvider, &u.WorkspaceName,
		&u.CreatedAt, &u.LastLoginAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UpsertAdminFromGoogle is the idempotent "find or create on Google login".
// Resolution order:
//  1. A row already linked to this google_id → return it, refresh name/avatar.
//  2. A row with this email but no google_id → attach google_id to it
//     (upgrades a password account to support Google sign-in too).
//  3. A row with this email AND a different google_id → return that row
//     unchanged (the email is already tied to another Google account;
//     don't silently swap the link).
//  4. No row → insert a fresh OAuth-only admin.
func (s *Store) UpsertAdminFromGoogle(ctx context.Context, googleID, email, name, avatarURL string) (*models.AdminUser, error) {
	if u, err := s.GetAdminByGoogleID(ctx, googleID); err != nil {
		return nil, err
	} else if u != nil {
		// Already linked — refresh name/avatar.
		_, _ = s.DB.Exec(ctx, `
			UPDATE bc_admin_users
			SET name = COALESCE(NULLIF($2,''), name),
			    avatar_url = COALESCE(NULLIF($3,''), avatar_url),
			    oauth_provider = 'google'
			WHERE id = $1
		`, u.ID, name, avatarURL)
		return s.GetAdminByGoogleID(ctx, googleID)
	}
	// Try to link to an existing email row.
	if u, err := s.GetAdminByEmail(ctx, email); err != nil {
		return nil, err
	} else if u != nil {
		if u.GoogleID != nil && *u.GoogleID != "" && *u.GoogleID != googleID {
			// Email is already linked to a *different* Google account.
			// Return that user as-is — the operator may want to merge
			// accounts manually. We do NOT silently overwrite, because
			// that would let a Google account hijack someone else's
			// admin row.
			return u, nil
		}
		// u.GoogleID is NULL/empty — attach our google_id to this row.
		_, err := s.DB.Exec(ctx, `
			UPDATE bc_admin_users
			SET google_id = $1,
			    avatar_url = COALESCE(NULLIF($2,''), avatar_url),
			    oauth_provider = 'google'
			WHERE id = $3
		`, googleID, avatarURL, u.ID)
		if err != nil {
			return nil, err
		}
		return s.GetAdminByEmail(ctx, email)
	}
	return s.CreateAdminFromGoogle(ctx, googleID, email, name, avatarURL)
}

func (s *Store) CreateAdmin(ctx context.Context, email, hash, name, role string) (*models.AdminUser, error) {
	defaultWorkspace := name + "'s workspace"
	if name == "" {
		defaultWorkspace = "My Workspace"
	}
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_admin_users (email, password_hash, name, role, workspace_name)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, email, password_hash, name, role, is_active,
		          google_id, avatar_url, oauth_provider, workspace_name,
		          created_at, last_login_at
	`, email, hash, name, role, defaultWorkspace).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive,
		&u.GoogleID, &u.AvatarURL, &u.OAuthProvider, &u.WorkspaceName,
		&u.CreatedAt, &u.LastLoginAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) TouchAdminLogin(ctx context.Context, id int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_admin_users SET last_login_at=now() WHERE id=$1`, id)
	return err
}

// UpdateMyProfile lets the calling admin rename their workspace or
// display name. Returns the refreshed AdminUser so the caller can
// surface the new label without an extra round-trip.
func (s *Store) UpdateMyProfile(ctx context.Context, id int64, name, workspaceName string) (*models.AdminUser, error) {
	if strings.TrimSpace(workspaceName) == "" {
		return nil, fmt.Errorf("workspace_name cannot be empty")
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_admin_users
		SET name           = NULLIF($2, ''),
		    workspace_name = $3
		WHERE id = $1
	`, id, strings.TrimSpace(name), strings.TrimSpace(workspaceName))
	if err != nil {
		return nil, err
	}
	return s.GetAdminByID(ctx, id)
}

// GetAdminByID is the canonical admin lookup used by anything that
// already knows the admin_user_id (e.g. /auth/me, profile updates).
func (s *Store) GetAdminByID(ctx context.Context, id int64) (*models.AdminUser, error) {
	if id <= 0 {
		return nil, nil
	}
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		SELECT id, email, password_hash, name, role, is_active,
		       google_id, avatar_url, oauth_provider, workspace_name,
		       created_at, last_login_at
		FROM bc_admin_users WHERE id = $1
	`, id).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive,
		&u.GoogleID, &u.AvatarURL, &u.OAuthProvider, &u.WorkspaceName,
		&u.CreatedAt, &u.LastLoginAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// HasWhatsAppCredentials reports whether the admin has any *active* row
// in bc_whatsapp_credentials (used by auth.Me to tell the Layout whether
// to render the "configure WABA" banner). Removed rows are excluded so
// the user is forced to either restore or re-add their credentials.
func (s *Store) HasWhatsAppCredentials(ctx context.Context, adminID int64) (bool, error) {
	if adminID <= 0 {
		return false, nil
	}
	var exists bool
	err := s.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM bc_whatsapp_credentials WHERE admin_user_id=$1 AND removed_at IS NULL)`,
		adminID,
	).Scan(&exists)
	return exists, err
}

// ---------- whatsapp credentials ----------

// UpsertWhatsappCredentials writes (or replaces) one admin's WABA creds.
// accessToken + verifyToken are encrypted with encKey (AES-GCM) before
// being written. The plaintext values never touch the DB.
//
// When called against an already-removed row (removed_at IS NOT NULL),
// this is treated as a fresh re-add: removed_at is cleared, last_known_*
// snapshot columns are reset, and the encrypted blobs are overwritten.
func (s *Store) UpsertWhatsappCredentials(
	ctx context.Context,
	adminID int64,
	encKey []byte,
	phoneNumberID, accessToken, verifyToken, wabaID, apiVersion string,
) error {
	atEnc, atNonce, err := crypto.Encrypt(encKey, []byte(accessToken))
	if err != nil {
		return fmt.Errorf("encrypt access_token: %w", err)
	}
	vtEnc, vtNonce, err := crypto.Encrypt(encKey, []byte(verifyToken))
	if err != nil {
		return fmt.Errorf("encrypt verify_token: %w", err)
	}

	var wabaArg any
	if strings.TrimSpace(wabaID) == "" {
		wabaArg = nil
	} else {
		wabaArg = wabaID
	}
	if apiVersion == "" {
		apiVersion = "v25.0"
	}

	_, err = s.DB.Exec(ctx, `
		INSERT INTO bc_whatsapp_credentials
			(admin_user_id, phone_number_id, waba_id, api_version,
			 access_token_enc, access_token_nonce,
			 verify_token_enc, verify_token_nonce,
			 is_verified, verified_at, last_error, updated_at,
			 removed_at, removed_by,
			 last_known_phone_number_id, last_known_waba_id, last_known_api_version, last_seen_is_verified)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, FALSE, NULL, NULL, now(),
		        NULL, NULL, NULL, NULL, NULL, NULL)
		ON CONFLICT (admin_user_id) DO UPDATE SET
			phone_number_id    = EXCLUDED.phone_number_id,
			waba_id            = EXCLUDED.waba_id,
			api_version        = EXCLUDED.api_version,
			access_token_enc   = EXCLUDED.access_token_enc,
			access_token_nonce = EXCLUDED.access_token_nonce,
			verify_token_enc   = EXCLUDED.verify_token_enc,
			verify_token_nonce = EXCLUDED.verify_token_nonce,
			is_verified        = FALSE,
			verified_at        = NULL,
			last_error         = NULL,
			updated_at         = now(),
			removed_at         = NULL,
			removed_by         = NULL,
			last_known_phone_number_id = NULL,
			last_known_waba_id         = NULL,
			last_known_api_version     = NULL,
			last_seen_is_verified      = NULL
	`, adminID, phoneNumberID, wabaArg, apiVersion,
		atEnc, atNonce, vtEnc, vtNonce)
	return err
}

// GetWhatsappCredentials returns the metadata + decrypted tokens for
// one admin. Decryption happens in-memory; the returned struct must
// not be serialised to clients (the encrypted byte fields would leak).
//
// When the row exists but removed_at IS NOT NULL, the returned creds
// carries the snapshotted last_known_* fields instead of the (now
// historical) live values. The access/verify tokens are still
// decrypted if requested (so a "Restore" round-trip is possible without
// re-asking the user), but callers must NOT forward them to the client
// when IsRemoved is true — only the public metadata is safe to ship.
func (s *Store) GetWhatsappCredentials(
	ctx context.Context, adminID int64, encKey []byte,
) (creds *models.WhatsappCredentials, accessToken, verifyToken string, err error) {
	var (
		phoneNumberID                               string
		wabaArg                                     *string
		atEnc, atNonce, vtEnc, vtNonce              []byte
		apiVersion                                  string
		isVerified                                  bool
		verifiedAt                                  *time.Time
		lastError                                   *string
		createdAt, updatedAt                        time.Time
		removedAt                                   *time.Time
		removedBy                                   *int64
		lastKnownPhone, lastKnownWaba, lastKnownAPI *string
		lastSeenVerified                            *bool
	)
	row := s.DB.QueryRow(ctx, `
		SELECT phone_number_id, waba_id, api_version,
		       access_token_enc, access_token_nonce,
		       verify_token_enc, verify_token_nonce,
		       is_verified, verified_at, last_error, created_at, updated_at,
		       removed_at, removed_by,
		       last_known_phone_number_id, last_known_waba_id, last_known_api_version, last_seen_is_verified
		FROM bc_whatsapp_credentials WHERE admin_user_id=$1
	`, adminID)
	if err := row.Scan(
		&phoneNumberID, &wabaArg, &apiVersion,
		&atEnc, &atNonce, &vtEnc, &vtNonce,
		&isVerified, &verifiedAt, &lastError, &createdAt, &updatedAt,
		&removedAt, &removedBy,
		&lastKnownPhone, &lastKnownWaba, &lastKnownAPI, &lastSeenVerified,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, "", "", nil
		}
		return nil, "", "", err
	}

	at, err := crypto.Decrypt(encKey, atEnc, atNonce)
	if err != nil {
		return nil, "", "", fmt.Errorf("decrypt access_token: %w", err)
	}
	vt, err := crypto.Decrypt(encKey, vtEnc, vtNonce)
	if err != nil {
		return nil, "", "", fmt.Errorf("decrypt verify_token: %w", err)
	}

	displayPhone := phoneNumberID
	displayWaba := wabaArg
	displayAPI := apiVersion
	displayVerified := isVerified
	if removedAt != nil {
		// Show the user what they last had — but tokens stay encrypted at rest.
		if lastKnownPhone != nil {
			displayPhone = *lastKnownPhone
		}
		if lastKnownWaba != nil {
			displayWaba = lastKnownWaba
		}
		if lastKnownAPI != nil {
			displayAPI = *lastKnownAPI
		}
		if lastSeenVerified != nil {
			displayVerified = *lastSeenVerified
		}
	}

	creds = &models.WhatsappCredentials{
		AdminUserID:   adminID,
		PhoneNumberID: displayPhone,
		WABAID:        displayWaba,
		APIVersion:    displayAPI,
		IsVerified:    displayVerified,
		VerifiedAt:    verifiedAt,
		LastError:     lastError,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		RemovedAt:     removedAt,
		RemovedBy:     removedBy,
	}
	return creds, string(at), string(vt), nil
}

// MarkWhatsappVerified records the outcome of the last "Test connection"
// probe (called from handlers/settings.go). isVerified=true flips the
// is_verified flag and clears last_error; isVerified=false stores the
// Meta error in last_error so the UI can show it.
func (s *Store) MarkWhatsappVerified(ctx context.Context, adminID int64, isVerified bool, lastError string) error {
	var errArg any
	if lastError == "" {
		errArg = nil
	} else {
		errArg = lastError
	}
	var verifiedAt any
	if isVerified {
		verifiedAt = time.Now()
	} else {
		verifiedAt = nil
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_whatsapp_credentials
		SET is_verified = $2,
		    verified_at = $3,
		    last_error  = $4,
		    updated_at  = now()
		WHERE admin_user_id = $1
	`, adminID, isVerified, verifiedAt, errArg)
	return err
}

// DeleteWhatsappCredentials soft-deletes one admin's row: stamps
// removed_at + removed_by, snapshots the public identifiers into
// last_known_*, and writes a 'removed' row to bc_credentials_history.
// The encrypted blobs stay on disk so a "Restore" can bring them back
// without re-asking the user for the access token.
func (s *Store) DeleteWhatsappCredentials(ctx context.Context, adminID, removedBy int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_whatsapp_credentials
		SET removed_at                  = now(),
		    removed_by                  = $2,
		    last_known_phone_number_id  = phone_number_id,
		    last_known_waba_id          = waba_id,
		    last_known_api_version      = api_version,
		    last_seen_is_verified       = is_verified,
		    updated_at                  = now()
		WHERE admin_user_id = $1 AND removed_at IS NULL
	`, adminID, removedBy)
	return err
}

// RestoreWhatsappCredentials clears the soft-delete flags so the row
// becomes "active" again. The encrypted tokens stay untouched — they're
// still in the row, we just flip removed_at/removed_by back to NULL.
// If the user re-saves through PUT /settings/whatsapp after restoring,
// the tokens will be re-encrypted with a fresh nonce as before.
func (s *Store) RestoreWhatsappCredentials(ctx context.Context, adminID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_whatsapp_credentials
		SET removed_at                  = NULL,
		    removed_by                  = NULL,
		    last_known_phone_number_id  = NULL,
		    last_known_waba_id          = NULL,
		    last_known_api_version      = NULL,
		    last_seen_is_verified       = NULL,
		    is_verified                 = FALSE,
		    verified_at                 = NULL,
		    last_error                  = NULL,
		    updated_at                  = now()
		WHERE admin_user_id = $1 AND removed_at IS NOT NULL
	`, adminID)
	return err
}

// InsertCredentialsHistory records one audit row for a credentials
// lifecycle event. Called from the settings handler after every save /
// soft-delete / restore so the UI can render "you last saved on X by Y".
func (s *Store) InsertCredentialsHistory(
	ctx context.Context,
	adminUserID int64,
	action string,
	phoneNumberID, wabaID, apiVersion *string,
	isVerified *bool,
	actorID *int64,
	ip, ua *string,
) error {
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_credentials_history
			(admin_user_id, action, phone_number_id, waba_id, api_version, is_verified,
			 actor_id, ip_address, user_agent)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, adminUserID, action, phoneNumberID, wabaID, apiVersion, isVerified,
		actorID, ip, ua)
	return err
}

// ListCredentialsHistory returns the most recent lifecycle events for
// one admin, newest first. Used to render "Activity" inside the
// Settings card.
func (s *Store) ListCredentialsHistory(ctx context.Context, adminUserID int64, limit int) ([]models.CredentialsHistoryEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, action, phone_number_id, waba_id, api_version,
		       is_verified, actor_id, ip_address, user_agent, created_at
		FROM bc_credentials_history
		WHERE admin_user_id = $1
		ORDER BY id DESC
		LIMIT $2
	`, adminUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CredentialsHistoryEntry{}
	for rows.Next() {
		var h models.CredentialsHistoryEntry
		if err := rows.Scan(&h.ID, &h.AdminUserID, &h.Action, &h.PhoneNumberID, &h.WABAID,
			&h.APIVersion, &h.IsVerified, &h.ActorID, &h.IPAddress, &h.UserAgent, &h.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, nil
}

// FindAdminByVerifyToken decrypts every stored verify_token and returns
// the admin id of the one that matches `token`. Used by the Meta
// webhook verification handshake.
//
// We scan the encrypted blobs for every admin and decrypt in-memory —
// verify-token handshakes are O(admins) but happen at most a handful
// of times per deployment, so the cost is fine. If the user-base ever
// grows large, switch to a per-admin bcrypt-style hash with a lookup
// index; the current shape favours low ops complexity.
func (s *Store) FindAdminByVerifyToken(ctx context.Context, encKey []byte, token string) (int64, error) {
	if token == "" {
		return 0, nil
	}
	rows, err := s.DB.Query(ctx, `
		SELECT admin_user_id, verify_token_enc, verify_token_nonce
		FROM bc_whatsapp_credentials
		WHERE removed_at IS NULL
		ORDER BY is_verified DESC, verified_at DESC NULLS LAST, updated_at DESC
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			adminID int64
			enc     []byte
			nonce   []byte
		)
		if err := rows.Scan(&adminID, &enc, &nonce); err != nil {
			return 0, err
		}
		pt, err := crypto.Decrypt(encKey, enc, nonce)
		if err != nil {
			// Skip rows we can't decrypt (key rotation edge case).
			continue
		}
		if subtle.ConstantTimeCompare([]byte(pt), []byte(token)) == 1 {
			return adminID, nil
		}
	}
	return 0, nil
}

// FindAdminByPhoneNumberID returns the admin id of the credentials row
// whose phone_number_id matches (used by the webhook to attribute
// inbound payloads to the right admin).
func (s *Store) FindAdminByPhoneNumberID(ctx context.Context, phoneID string) (int64, error) {
	if phoneID == "" {
		return 0, nil
	}
	var id int64
	err := s.DB.QueryRow(ctx,
		`SELECT admin_user_id
		   FROM bc_whatsapp_credentials
		  WHERE phone_number_id=$1
		    AND removed_at IS NULL
		  ORDER BY is_verified DESC, verified_at DESC NULLS LAST, updated_at DESC
		  LIMIT 1`,
		phoneID,
	).Scan(&id)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	return id, err
}

// ListVerifiedAdminIDs returns admin ids that have a verified credentials
// row, most-recently-verified first. Used as a fallback owner for
// orphan inbound (where Meta didn't include metadata.phone_number_id
// or it didn't match any row).
func (s *Store) ListVerifiedAdminIDs(ctx context.Context) ([]int64, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT admin_user_id FROM bc_whatsapp_credentials
		WHERE is_verified = TRUE
		  AND removed_at IS NULL
		ORDER BY verified_at DESC NULLS LAST, updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// ---------- retailers ----------

// UpsertRetailer is per-admin. The conflict target is the per-admin
// (admin_user_id, retailer_code) unique index (migration 004). If the
// row already exists, the new admin_user_id wins; this matters when
// an admin re-uploads the same retailer.
func (s *Store) UpsertRetailer(ctx context.Context, adminUserID int64, code, name, phone, city, state string) (int64, error) {
	if adminUserID <= 0 {
		return 0, fmt.Errorf("UpsertRetailer: adminUserID required")
	}
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_retailers
			(admin_user_id, retailer_code, retailer_name, whatsapp_number, city, state)
		VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''))
		ON CONFLICT (admin_user_id, retailer_code) WHERE admin_user_id IS NOT NULL DO UPDATE
		  SET retailer_name = EXCLUDED.retailer_name,
		      whatsapp_number = EXCLUDED.whatsapp_number,
		      city = COALESCE(EXCLUDED.city, bc_retailers.city),
		      state = COALESCE(EXCLUDED.state, bc_retailers.state),
		      updated_at = now()
		RETURNING id
	`, adminUserID, code, name, phone, city, state).Scan(&id)
	return id, err
}

// ListRetailers lists ONLY the retailers the admin owns. Legacy NULL
// rows are assigned to the first admin by `cmd/seed` so no data is
// ever visible to more than one admin.
func (s *Store) ListRetailers(ctx context.Context, adminUserID int64, search string, limit, offset int) ([]models.Retailer, int, error) {
	args := []any{adminUserID}
	where := `WHERE r.admin_user_id = $1`
	if search != "" {
		args = append(args, "%"+search+"%")
		idx := itoa(len(args))
		where += ` AND (r.retailer_code ILIKE $` + idx + ` OR r.retailer_name ILIKE $` + idx + ` OR r.whatsapp_number ILIKE $` + idx + `)`
	}
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_retailers r "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	q := `SELECT r.id, r.admin_user_id, r.retailer_code, r.retailer_name, r.whatsapp_number, r.city, r.state,
	             r.is_opted_out, r.opted_out_at, r.opted_out_reason, r.created_at, r.updated_at
	      FROM bc_retailers r ` + where + ` ORDER BY r.id DESC LIMIT $` + itoa(len(args)-1) + ` OFFSET $` + itoa(len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.Retailer{}
	for rows.Next() {
		var r models.Retailer
		if err := rows.Scan(&r.ID, &r.AdminUserID, &r.RetailerCode, &r.RetailerName, &r.WhatsappNumber,
			&r.City, &r.State, &r.IsOptedOut, &r.OptedOutAt, &r.OptedOutReason, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, nil
}

func (s *Store) GetRetailer(ctx context.Context, adminUserID, id int64) (*models.Retailer, error) {
	var r models.Retailer
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, retailer_code, retailer_name, whatsapp_number, city, state,
		       is_opted_out, opted_out_at, opted_out_reason, created_at, updated_at
		FROM bc_retailers
		WHERE id=$1 AND admin_user_id=$2
	`, id, adminUserID).Scan(&r.ID, &r.AdminUserID, &r.RetailerCode, &r.RetailerName, &r.WhatsappNumber,
		&r.City, &r.State, &r.IsOptedOut, &r.OptedOutAt, &r.OptedOutReason, &r.CreatedAt, &r.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) SetOptOut(ctx context.Context, adminUserID, id int64, optOut bool, reason string) error {
	if optOut {
		_, err := s.DB.Exec(ctx, `
			UPDATE bc_retailers
			SET is_opted_out=TRUE, opted_out_at=now(), opted_out_reason=NULLIF($3,''), updated_at=now()
			WHERE id=$1 AND admin_user_id=$2
		`, id, adminUserID, reason)
		return err
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_retailers
		SET is_opted_out=FALSE, opted_out_at=NULL, opted_out_reason=NULL, updated_at=now()
		WHERE id=$1 AND admin_user_id=$2
	`, id, adminUserID)
	return err
}

// ---------- batches ----------

// CreateBatch stamps adminUserID into uploaded_by (the column already
// exists). uploaded_by doubles as the owner for filtering reads.
func (s *Store) CreateBatch(ctx context.Context, adminUserID int64, b *models.UploadBatch) (int64, error) {
	if adminUserID <= 0 {
		return 0, fmt.Errorf("CreateBatch: adminUserID required")
	}
	uploadedBy := adminUserID
	return s.insertReturningID(ctx, `
		INSERT INTO bc_upload_batches (file_name, file_path, file_size_bytes, mime_type, uploaded_by, notes)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, b.FileName, b.FilePath, b.FileSizeBytes, b.MimeType, &uploadedBy, b.Notes)
}

func (s *Store) UpdateBatchCounts(ctx context.Context, id int64, total, valid, invalid int) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_upload_batches SET total_rows=$2, valid_rows=$3, invalid_rows=$4,
		  status = CASE WHEN status='uploaded' THEN 'validated' ELSE status END
		WHERE id=$1
	`, id, total, valid, invalid)
	return err
}

func (s *Store) SetBatchStatus(ctx context.Context, id int64, status string) error {
	q := `UPDATE bc_upload_batches SET status=$2`
	args := []any{id, status}
	if status == "approved" {
		q += `, approved_at=now()`
	}
	if status == "sending" {
		q += `, started_at=now()`
	}
	if status == "completed" {
		q += `, completed_at=now()`
	}
	q += ` WHERE id=$1`
	args = []any{id, status}
	if status == "approved" {
		q = `UPDATE bc_upload_batches SET status=$2, approved_at=now() WHERE id=$1`
	} else if status == "sending" {
		q = `UPDATE bc_upload_batches SET status=$2, started_at=now() WHERE id=$1`
	} else if status == "completed" {
		q = `UPDATE bc_upload_batches SET status=$2, completed_at=now() WHERE id=$1`
	} else {
		q = `UPDATE bc_upload_batches SET status=$2 WHERE id=$1`
	}
	_, err := s.DB.Exec(ctx, q, args...)
	return err
}

func (s *Store) ApproveBatch(ctx context.Context, batchID, approverID int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_upload_batches SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, batchID, approverID)
	return err
}

// ApproveBatchOnly flips a batch's status to 'approved' WITHOUT
// queuing any message jobs. This unlocks the per-batch AI follow-up
// toggle on the Upload page (the rule is "AI activates only after
// Approve & open") without committing the workspace to actually
// sending the WhatsApp messages right now.
//
// The existing ApproveBatch() does both — flip status AND queue
// jobs — which is the right one-shot flow but doesn't give the admin
// a way to stage a batch for AI tracking first.
//
// Idempotent: re-approving an already-approved batch is a no-op at
// the SQL level (the WHERE only matches status='validated'), so a
// second call returns ErrNoRows and the handler can map that to 409.
func (s *Store) ApproveBatchOnly(ctx context.Context, batchID, approverID int64) error {
	tag, err := s.DB.Exec(ctx,
		`UPDATE bc_upload_batches
		    SET status='approved', approved_by=$2, approved_at=now()
		  WHERE id=$1 AND status='validated'`,
		batchID, approverID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either the batch doesn't exist or it's already past
		// 'validated'. Return a sentinel; the handler maps it to 409.
		return pgx.ErrNoRows
	}
	return nil
}

// GetBatch fetches one batch if it belongs to the admin (or is legacy).
func (s *Store) GetBatch(ctx context.Context, adminUserID, id int64) (*models.UploadBatch, error) {
	var b models.UploadBatch
	err := s.DB.QueryRow(ctx, `
		SELECT id, file_name, file_path, file_size_bytes, mime_type,
		       total_rows, valid_rows, invalid_rows, status,
		       uploaded_by, approved_by, approved_at, started_at, completed_at, notes, created_at,
		       ai_followup_enabled, ai_followup_enabled_at,
		       display_name
		FROM bc_upload_batches
		WHERE id=$1 AND (uploaded_by=$2 OR uploaded_by IS NULL)
	`, id, adminUserID).Scan(&b.ID, &b.FileName, &b.FilePath, &b.FileSizeBytes, &b.MimeType,
		&b.TotalRows, &b.ValidRows, &b.InvalidRows, &b.Status,
		&b.UploadedBy, &b.ApprovedBy, &b.ApprovedAt, &b.StartedAt, &b.CompletedAt, &b.Notes, &b.CreatedAt,
		&b.AIFollowupEnabled, &b.AIFollowupEnabledAt,
		&b.DisplayName)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *Store) ListBatches(ctx context.Context, adminUserID int64, limit, offset int) ([]models.UploadBatch, int, error) {
	var total int
	if err := s.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM bc_upload_batches WHERE (uploaded_by=$1 OR uploaded_by IS NULL)`,
		adminUserID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, file_name, file_path, file_size_bytes, mime_type,
		       total_rows, valid_rows, invalid_rows, status,
		       uploaded_by, approved_by, approved_at, started_at, completed_at, notes, created_at,
		       ai_followup_enabled, ai_followup_enabled_at,
		       display_name
		FROM bc_upload_batches
		WHERE (uploaded_by=$1 OR uploaded_by IS NULL)
		ORDER BY id DESC LIMIT $2 OFFSET $3
	`, adminUserID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.UploadBatch{}
	for rows.Next() {
		var b models.UploadBatch
		if err := rows.Scan(&b.ID, &b.FileName, &b.FilePath, &b.FileSizeBytes, &b.MimeType,
			&b.TotalRows, &b.ValidRows, &b.InvalidRows, &b.Status,
			&b.UploadedBy, &b.ApprovedBy, &b.ApprovedAt, &b.StartedAt, &b.CompletedAt, &b.Notes, &b.CreatedAt,
			&b.AIFollowupEnabled, &b.AIFollowupEnabledAt,
			&b.DisplayName); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, nil
}

// UpdateBatchDisplayName sets (or clears) the operator-chosen label on a
// batch. Passing `name == nil` clears the override so the UI falls back
// to file_name. The (uploaded_by = caller OR NULL) guard mirrors the
// ownership rule used everywhere else in this file — a cross-tenant id
// returns ErrNoRows so the handler can render a 404 instead of silently
// mutating zero rows.
//
// We do NOT stamp updated_at on the batch itself because there isn't one
// — the table only carries created_at. The audit log captures who did
// what and when, which is what the audit page reads.
func (s *Store) UpdateBatchDisplayName(ctx context.Context, adminUserID, batchID int64, name *string) (*models.UploadBatch, error) {
	// pgx doesn't have a clean way to UPDATE ... RETURNING a single
	// nullable column into *string inside a CTE, so split into two
	// statements inside a transaction to avoid a TOCTOU between the
	// ownership probe and the UPDATE.
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var owned bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM bc_upload_batches WHERE id=$1 AND (uploaded_by=$2 OR uploaded_by IS NULL))`,
		batchID, adminUserID,
	).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return nil, pgx.ErrNoRows
	}

	var nameArg any
	if name != nil {
		nameArg = *name
	}

	if _, err := tx.Exec(ctx,
		`UPDATE bc_upload_batches SET display_name = $2 WHERE id = $1`,
		batchID, nameArg,
	); err != nil {
		return nil, err
	}

	var b models.UploadBatch
	if err := tx.QueryRow(ctx, `
		SELECT id, file_name, file_path, file_size_bytes, mime_type,
		       total_rows, valid_rows, invalid_rows, status,
		       uploaded_by, approved_by, approved_at, started_at, completed_at, notes, created_at,
		       ai_followup_enabled, ai_followup_enabled_at,
		       display_name
		FROM bc_upload_batches WHERE id = $1
	`, batchID).Scan(&b.ID, &b.FileName, &b.FilePath, &b.FileSizeBytes, &b.MimeType,
		&b.TotalRows, &b.ValidRows, &b.InvalidRows, &b.Status,
		&b.UploadedBy, &b.ApprovedBy, &b.ApprovedAt, &b.StartedAt, &b.CompletedAt, &b.Notes, &b.CreatedAt,
		&b.AIFollowupEnabled, &b.AIFollowupEnabledAt,
		&b.DisplayName); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &b, nil
}

// ---------- AI follow-up (per batch) ----------

// SetBatchAIFollowup toggles the per-batch AI follow-up flag and, on
// enable, back-fills bc_batch_ai_recipients with one 'pending' row per
// valid recipient in the batch (idempotent on (batch_id,
// whatsapp_number)). On disable, the rows are left in place (history
// preserved) but ai_status is set to 'disabled' so the UI knows the
// agent is no longer active for them.
//
// This is admin-scoped: it scopes the update by (id, uploaded_by) so a
// tenant cannot toggle another tenant's batches.
func (s *Store) SetBatchAIFollowup(ctx context.Context, adminUserID, batchID int64, enabled bool) (*SetBatchAIFollowupResult, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Verify the batch belongs to this admin. We do this explicitly so
	// the toggle is a no-op (returns 404) for cross-tenant access
	// instead of silently updating zero rows.
	var owned bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM bc_upload_batches WHERE id=$1 AND (uploaded_by=$2 OR uploaded_by IS NULL))`,
		batchID, adminUserID,
	).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return nil, nil
	}

	// Flip the flag. We always set ai_followup_enabled_at to the
	// moment of the most recent change so the UI can show "enabled X
	// minutes ago" — even on disable, the timestamp reflects the last
	// toggle (the plan keeps history simple).
	if _, err := tx.Exec(ctx,
		`UPDATE bc_upload_batches
		    SET ai_followup_enabled    = $2,
		        ai_followup_enabled_at = now()
		  WHERE id = $1`,
		batchID, enabled,
	); err != nil {
		return nil, err
	}

	var backfilled int
	if enabled {
		// Back-fill recipient rows for every valid billing record in
		// this batch. We stamp admin_user_id from the owning batch,
		// coercing NULL (legacy batch uploaded before per-admin
		// ownership was tracked) to the calling admin so the
		// back-fill still works on those rows.
		//
		// The CTE wrapper lets us count newly-inserted rows in the
		// same statement. A zero insert count does not necessarily
		// mean the batch has no valid phones: this endpoint is
		// idempotent, so the recipient rows may already exist.
		//
		// ON CONFLICT DO NOTHING keeps this idempotent — re-toggling
		// on after a disable still refreshes the status from
		// 'disabled' back to 'pending' in the follow-up UPDATE
		// below.
		if err := tx.QueryRow(ctx, `
			WITH ins AS (
				INSERT INTO bc_batch_ai_recipients
					(batch_id, admin_user_id, retailer_id, whatsapp_number, ai_status)
				SELECT br.batch_id,
				       COALESCE(b.uploaded_by, $2),
				       br.retailer_id, br.whatsapp_number, 'pending'
				  FROM bc_billing_records br
				  JOIN bc_upload_batches b ON b.id = br.batch_id
				 WHERE br.batch_id = $1
				   AND br.is_valid = TRUE
				   AND br.whatsapp_number IS NOT NULL
				   AND trim(br.whatsapp_number) <> ''
				ON CONFLICT (batch_id, whatsapp_number) DO NOTHING
				RETURNING 1
			)
			SELECT count(*) FROM ins
		`, batchID, adminUserID).Scan(&backfilled); err != nil {
			return nil, err
		}
		// If the insert count is zero, distinguish "already backfilled"
		// from "there is genuinely nothing to track".
		if backfilled == 0 {
			var trackable int
			if err := tx.QueryRow(ctx, `
				SELECT COUNT(DISTINCT br.whatsapp_number)::int
				  FROM bc_billing_records br
				  JOIN bc_upload_batches b ON b.id = br.batch_id
				 WHERE br.batch_id = $1
				   AND (b.uploaded_by = $2 OR b.uploaded_by IS NULL)
				   AND br.is_valid = TRUE
				   AND br.whatsapp_number IS NOT NULL
				   AND trim(br.whatsapp_number) <> ''
			`, batchID, adminUserID).Scan(&trackable); err != nil {
				return nil, err
			}
			if trackable == 0 {
				if err := tx.Commit(ctx); err != nil {
					return nil, err
				}
				batch, err := s.GetBatch(ctx, adminUserID, batchID)
				if err != nil {
					return nil, err
				}
				return &SetBatchAIFollowupResult{Batch: batch, RecipientsBackfilled: 0}, ErrNoRecipientsToTrack
			}
		}
		// Re-activate any rows that were previously disabled by this
		// admin. We only flip rows that are currently 'disabled' or
		// 'pending' — we do NOT clobber 'active' / 'handed_off' /
		// 'opted_out' / 'failed' because those carry real history
		// (the agent talked to the retailer already).
		if _, err := tx.Exec(ctx, `
			UPDATE bc_batch_ai_recipients
			   SET ai_status = 'pending',
			       last_event = 're-enabled by admin',
			       last_event_at = now()
			 WHERE batch_id = $1
			   AND ai_status = 'disabled'
		`, batchID); err != nil {
			return nil, err
		}
	} else {
		// Disable: mark any rows that haven't seen real agent
		// activity as 'disabled'. Rows already in 'active',
		// 'handed_off', 'opted_out', or 'failed' keep their status
		// (history of what actually happened).
		if _, err := tx.Exec(ctx, `
			UPDATE bc_batch_ai_recipients
			   SET ai_status = 'disabled',
			       last_event = 'disabled by admin',
			       last_event_at = now()
			 WHERE batch_id = $1
			   AND ai_status IN ('pending')
		`, batchID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	batch, err := s.GetBatch(ctx, adminUserID, batchID)
	if err != nil {
		return nil, err
	}
	return &SetBatchAIFollowupResult{Batch: batch, RecipientsBackfilled: backfilled}, nil
}

// SetBatchAIFollowupResult bundles the toggled batch with the
// recipient-row count, so the handler can return a richer response
// (especially the 422 case where the flag flipped to true on a batch
// that has zero valid WhatsApp numbers to track).
type SetBatchAIFollowupResult struct {
	Batch                *models.UploadBatch
	RecipientsBackfilled int
}

// ErrNoRecipientsToTrack is returned by SetBatchAIFollowup when the
// back-fill INSERT found zero valid WhatsApp numbers in the batch
// (every row had an empty/invalid phone, or the file had no valid
// rows at all). The flag still flips to true so the UI can render a
// "0 recipients" warning chip, but the handler maps this to 422 so
// the admin knows the agent will not see any recipients for this
// batch.
var ErrNoRecipientsToTrack = errors.New("no valid whatsapp numbers in this batch — nothing to track")

// BatchAIRecentMessage is one conversation turn included in the
// Bedrock-powered batch CRM summary. It keeps phone/retailer context
// beside the raw AI conversation message so the prompt can summarize
// multiple chats without losing who said what.
type BatchAIRecentMessage struct {
	RecipientID  int64
	Phone        string
	RetailerName string
	AIStatus     string
	Role         string
	Content      string
	CreatedAt    time.Time
	SendStatus   string
	SendError    string
}

// ListBatchAIInsights returns saved per-batch CRM intelligence rows for
// the current admin. The dashboard uses this for the overview so it can
// render action-required context without regenerating LLM summaries on
// every page load.
func (s *Store) ListBatchAIInsights(ctx context.Context, adminUserID int64, limit int) ([]models.BatchAIInsight, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, batch_id,
		       summary, mood, buyer_intent,
		       action_required, action_reason, priority_score, recommended_action,
		       what_happened, risks, next_actions, warm_leads, labels,
		       history_limit, history_used, model, provider,
		       last_message_at, last_analyzed_at, generated_at, generation_error,
		       created_at, updated_at
		  FROM bc_batch_ai_insights
		 WHERE admin_user_id = $1
		 ORDER BY action_required DESC, priority_score DESC, updated_at DESC
		 LIMIT $2
	`, adminUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []models.BatchAIInsight{}
	for rows.Next() {
		var in models.BatchAIInsight
		var happenedRaw, risksRaw, nextRaw, warmRaw, labelsRaw []byte
		if err := rows.Scan(
			&in.ID, &in.AdminUserID, &in.BatchID,
			&in.Summary, &in.Mood, &in.BuyerIntent,
			&in.ActionRequired, &in.ActionReason, &in.PriorityScore, &in.RecommendedAction,
			&happenedRaw, &risksRaw, &nextRaw, &warmRaw, &labelsRaw,
			&in.HistoryLimit, &in.HistoryUsed, &in.Model, &in.Provider,
			&in.LastMessageAt, &in.LastAnalyzedAt, &in.GeneratedAt, &in.GenerationError,
			&in.CreatedAt, &in.UpdatedAt,
		); err != nil {
			return nil, err
		}
		in.WhatHappened = decodeStringJSONList(happenedRaw)
		in.Risks = decodeStringJSONList(risksRaw)
		in.NextActions = decodeStringJSONList(nextRaw)
		in.Labels = decodeStringJSONList(labelsRaw)
		in.WarmLeads = decodeWarmLeadJSONList(warmRaw)
		out = append(out, in)
	}
	return out, rows.Err()
}

// GetBatchAIInsight fetches the saved CRM insight for one batch, if it
// exists. It is admin-scoped by the denormalized admin_user_id column.
func (s *Store) GetBatchAIInsight(ctx context.Context, adminUserID, batchID int64) (*models.BatchAIInsight, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, batch_id,
		       summary, mood, buyer_intent,
		       action_required, action_reason, priority_score, recommended_action,
		       what_happened, risks, next_actions, warm_leads, labels,
		       history_limit, history_used, model, provider,
		       last_message_at, last_analyzed_at, generated_at, generation_error,
		       created_at, updated_at
		  FROM bc_batch_ai_insights
		 WHERE admin_user_id = $1
		   AND batch_id = $2
		 LIMIT 1
	`, adminUserID, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var in models.BatchAIInsight
	var happenedRaw, risksRaw, nextRaw, warmRaw, labelsRaw []byte
	if err := rows.Scan(
		&in.ID, &in.AdminUserID, &in.BatchID,
		&in.Summary, &in.Mood, &in.BuyerIntent,
		&in.ActionRequired, &in.ActionReason, &in.PriorityScore, &in.RecommendedAction,
		&happenedRaw, &risksRaw, &nextRaw, &warmRaw, &labelsRaw,
		&in.HistoryLimit, &in.HistoryUsed, &in.Model, &in.Provider,
		&in.LastMessageAt, &in.LastAnalyzedAt, &in.GeneratedAt, &in.GenerationError,
		&in.CreatedAt, &in.UpdatedAt,
	); err != nil {
		return nil, err
	}
	in.WhatHappened = decodeStringJSONList(happenedRaw)
	in.Risks = decodeStringJSONList(risksRaw)
	in.NextActions = decodeStringJSONList(nextRaw)
	in.Labels = decodeStringJSONList(labelsRaw)
	in.WarmLeads = decodeWarmLeadJSONList(warmRaw)
	return &in, rows.Err()
}

// UpsertBatchAIInsight saves the latest generated CRM intelligence for a
// batch. Existing rows are replaced in-place so the overview always reads
// one current row per batch.
func (s *Store) UpsertBatchAIInsight(ctx context.Context, in *models.BatchAIInsight) (*models.BatchAIInsight, error) {
	if in == nil {
		return nil, errors.New("nil batch ai insight")
	}
	happened := encodeJSONList(in.WhatHappened)
	risks := encodeJSONList(in.Risks)
	nextActions := encodeJSONList(in.NextActions)
	warm := encodeJSONList(in.WarmLeads)
	labels := encodeJSONList(in.Labels)
	if in.LastAnalyzedAt.IsZero() {
		in.LastAnalyzedAt = time.Now().UTC()
	}
	if in.GeneratedAt.IsZero() {
		in.GeneratedAt = in.LastAnalyzedAt
	}
	rows, err := s.DB.Query(ctx, `
		INSERT INTO bc_batch_ai_insights (
			admin_user_id, batch_id,
			summary, mood, buyer_intent,
			action_required, action_reason, priority_score, recommended_action,
			what_happened, risks, next_actions, warm_leads, labels,
			history_limit, history_used, model, provider,
			last_message_at, last_analyzed_at, generated_at, generation_error
		)
		VALUES (
			$1, $2,
			$3, $4, $5,
			$6, $7, $8, $9,
			$10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
			$15, $16, $17, $18,
			$19, $20, $21, $22
		)
		ON CONFLICT (admin_user_id, batch_id)
		DO UPDATE SET
			summary = EXCLUDED.summary,
			mood = EXCLUDED.mood,
			buyer_intent = EXCLUDED.buyer_intent,
			action_required = EXCLUDED.action_required,
			action_reason = EXCLUDED.action_reason,
			priority_score = EXCLUDED.priority_score,
			recommended_action = EXCLUDED.recommended_action,
			what_happened = EXCLUDED.what_happened,
			risks = EXCLUDED.risks,
			next_actions = EXCLUDED.next_actions,
			warm_leads = EXCLUDED.warm_leads,
			labels = EXCLUDED.labels,
			history_limit = EXCLUDED.history_limit,
			history_used = EXCLUDED.history_used,
			model = EXCLUDED.model,
			provider = EXCLUDED.provider,
			last_message_at = EXCLUDED.last_message_at,
			last_analyzed_at = EXCLUDED.last_analyzed_at,
			generated_at = EXCLUDED.generated_at,
			generation_error = EXCLUDED.generation_error
		RETURNING id, admin_user_id, batch_id,
		          summary, mood, buyer_intent,
		          action_required, action_reason, priority_score, recommended_action,
		          what_happened, risks, next_actions, warm_leads, labels,
		          history_limit, history_used, model, provider,
		          last_message_at, last_analyzed_at, generated_at, generation_error,
		          created_at, updated_at
	`, in.AdminUserID, in.BatchID,
		in.Summary, in.Mood, in.BuyerIntent,
		in.ActionRequired, in.ActionReason, in.PriorityScore, in.RecommendedAction,
		happened, risks, nextActions, warm, labels,
		in.HistoryLimit, in.HistoryUsed, in.Model, in.Provider,
		in.LastMessageAt, in.LastAnalyzedAt, in.GeneratedAt, in.GenerationError)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var saved models.BatchAIInsight
	var happenedRaw, risksRaw, nextRaw, warmRaw, labelsRaw []byte
	if err := rows.Scan(
		&saved.ID, &saved.AdminUserID, &saved.BatchID,
		&saved.Summary, &saved.Mood, &saved.BuyerIntent,
		&saved.ActionRequired, &saved.ActionReason, &saved.PriorityScore, &saved.RecommendedAction,
		&happenedRaw, &risksRaw, &nextRaw, &warmRaw, &labelsRaw,
		&saved.HistoryLimit, &saved.HistoryUsed, &saved.Model, &saved.Provider,
		&saved.LastMessageAt, &saved.LastAnalyzedAt, &saved.GeneratedAt, &saved.GenerationError,
		&saved.CreatedAt, &saved.UpdatedAt,
	); err != nil {
		return nil, err
	}
	saved.WhatHappened = decodeStringJSONList(happenedRaw)
	saved.Risks = decodeStringJSONList(risksRaw)
	saved.NextActions = decodeStringJSONList(nextRaw)
	saved.Labels = decodeStringJSONList(labelsRaw)
	saved.WarmLeads = decodeWarmLeadJSONList(warmRaw)
	return &saved, rows.Err()
}

// MarkBatchAIInsightError records a failed refresh attempt without
// destroying the last useful summary. The UI can keep showing the saved
// insight and surface the error as a small warning.
func (s *Store) MarkBatchAIInsightError(ctx context.Context, adminUserID, batchID int64, generationError string) error {
	generationError = strings.TrimSpace(generationError)
	if len([]rune(generationError)) > 600 {
		generationError = string([]rune(generationError)[:600])
	}
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_batch_ai_insights (
			admin_user_id, batch_id, summary, mood, buyer_intent,
			action_required, action_reason, priority_score, recommended_action,
			what_happened, risks, next_actions, warm_leads, labels,
			history_limit, history_used, model, provider,
			last_analyzed_at, generated_at, generation_error
		)
		VALUES (
			$1, $2, '', 'mixed', 'unknown',
			FALSE, '', 0, '',
			'[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
			20, 0, '', '',
			now(), now(), $3
		)
		ON CONFLICT (admin_user_id, batch_id)
		DO UPDATE SET
			last_analyzed_at = now(),
			generation_error = EXCLUDED.generation_error
	`, adminUserID, batchID, generationError)
	return err
}

func encodeJSONList(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("[]")
	}
	return b
}

func decodeStringJSONList(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func decodeWarmLeadJSONList(raw []byte) []models.BatchAIWarmLead {
	if len(raw) == 0 {
		return []models.BatchAIWarmLead{}
	}
	var out []models.BatchAIWarmLead
	if err := json.Unmarshal(raw, &out); err != nil {
		return []models.BatchAIWarmLead{}
	}
	if out == nil {
		return []models.BatchAIWarmLead{}
	}
	return out
}

// ListBatchAIRecipients returns one row per (batch, phone) in
// bc_batch_ai_recipients for the given batch, enriched with the
// retailer name and a denormalized preview of the last AI-conversation
// message. Returns an empty slice (not an error) if the batch has no
// rows yet — the frontend renders an empty state in that case.
//
// Admin-scoped: callers must pass their own adminUserID. Access is
// allowed when either the upload batch is owned/legacy-shared or the
// batch already has admin-owned AI recipient rows.
func (s *Store) ListBatchAIRecipients(ctx context.Context, adminUserID, batchID int64) ([]models.BatchAIRecipient, error) {
	// Ownership probe. Most callers are upload-batch oriented, but the
	// AI CRM can legitimately navigate from bc_batch_ai_recipients rows
	// that are already stamped with admin_user_id even when an older
	// upload batch header is legacy/mismatched.
	var owned bool
	if err := s.DB.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1
			  FROM bc_upload_batches
			 WHERE id=$1
			   AND (uploaded_by=$2 OR uploaded_by IS NULL)
			UNION ALL
			SELECT 1
			  FROM bc_batch_ai_recipients
			 WHERE batch_id=$1
			   AND admin_user_id=$2
			 LIMIT 1
		)`,
		batchID, adminUserID,
	).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return []models.BatchAIRecipient{}, nil
	}

	// We pull the last message preview with a correlated subquery
	// (LIMIT 1 ORDER BY created_at DESC) from bc_ai_conversation_messages
	// matching (admin_user_id, phone). admin_user_id is denormalized
	// on bc_batch_ai_recipients (stamped at back-fill time from
	// bc_upload_batches.uploaded_by) so we don't need to hop through
	// the batch table here.
	rows, err := s.DB.Query(ctx, `
		SELECT r.id, r.batch_id, r.retailer_id, r.whatsapp_number,
		       ret.retailer_name,
		       r.ai_status, r.conversation_id,
		       r.last_event_at, r.last_event,
		       r.created_at, r.updated_at,
		       COALESCE(last_msg.content, '')            AS last_content,
		       COALESCE(last_msg.role, '')               AS last_role,
		       last_msg.created_at                       AS last_msg_at
		  FROM bc_batch_ai_recipients r
		  LEFT JOIN bc_retailers ret ON ret.id = r.retailer_id
		  LEFT JOIN LATERAL (
		    SELECT m.content, m.role, m.created_at
		      FROM bc_ai_conversation_messages m
		     WHERE m.admin_user_id = r.admin_user_id
		       AND m.phone = r.whatsapp_number
		     ORDER BY m.created_at DESC
		     LIMIT 1
		  ) AS last_msg ON TRUE
		 WHERE r.batch_id = $1
		   AND r.admin_user_id = $2
		 ORDER BY r.id ASC
	`, batchID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.BatchAIRecipient{}
	for rows.Next() {
		var r models.BatchAIRecipient
		var lastContent, lastRole string
		var lastAt *time.Time
		if err := rows.Scan(&r.ID, &r.BatchID, &r.RetailerID, &r.WhatsappNumber,
			&r.RetailerName,
			&r.AIStatus, &r.ConversationID,
			&r.LastEventAt, &r.LastEvent,
			&r.CreatedAt, &r.UpdatedAt,
			&lastContent, &lastRole, &lastAt); err != nil {
			return nil, err
		}
		// Map the role to a direction the frontend can render. The
		// inbox schema uses "user" (retailer → us) and "assistant"
		// (AI → retailer); we surface them as "in" / "out".
		r.LastMessagePreview = lastContent
		switch lastRole {
		case "user":
			r.LastMessageDirection = "in"
		case "assistant":
			r.LastMessageDirection = "out"
		}
		r.LastMessageAt = lastAt
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListBatchAIRecentMessages returns the latest N conversation messages
// across all AI-tracked recipients in a batch, then re-sorts them
// oldest-to-newest for prompt readability.
func (s *Store) ListBatchAIRecentMessages(ctx context.Context, adminUserID, batchID int64, limit int) ([]BatchAIRecentMessage, error) {
	if limit != 10 && limit != 20 {
		limit = 20
	}
	rows, err := s.DB.Query(ctx, `
		WITH batch_recipients AS (
			SELECT r.id AS recipient_id,
			       r.whatsapp_number,
			       COALESCE(ret.retailer_name, '') AS retailer_name,
			       r.ai_status
			  FROM bc_batch_ai_recipients r
			  LEFT JOIN bc_retailers ret ON ret.id = r.retailer_id
			 WHERE r.batch_id = $1
			   AND r.admin_user_id = $2
		),
		recent AS (
			SELECT br.recipient_id,
			       br.whatsapp_number,
			       br.retailer_name,
			       br.ai_status,
			       m.role,
			       m.content,
			       m.created_at,
			       COALESCE(m.send_status, '') AS send_status,
			       COALESCE(m.send_error, '') AS send_error
			  FROM batch_recipients br
			  JOIN bc_ai_conversation_messages m
			    ON m.admin_user_id = $2
			   AND m.phone = br.whatsapp_number
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT $3
		)
		SELECT recipient_id, whatsapp_number, retailer_name, ai_status,
		       role, content, created_at, send_status, send_error
		  FROM recent
		 ORDER BY created_at ASC, recipient_id ASC
	`, batchID, adminUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []BatchAIRecentMessage{}
	for rows.Next() {
		var m BatchAIRecentMessage
		if err := rows.Scan(
			&m.RecipientID, &m.Phone, &m.RetailerName, &m.AIStatus,
			&m.Role, &m.Content, &m.CreatedAt, &m.SendStatus, &m.SendError,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetBatchAIRecipient fetches a single recipient row by id, admin-scoped.
// Returns (nil, nil) when the row doesn't exist OR when the caller
// doesn't own it — we treat both as "not found" so cross-tenant
// requests get 404 instead of leaking row existence.
//
// Includes the same denormalized last_message_* fields as the list
// helper (LATERAL join on bc_ai_conversation_messages matching
// admin_user_id + phone). Used by the per-recipient workflow page.
func (s *Store) GetBatchAIRecipient(ctx context.Context, adminUserID, recipientID int64) (*models.BatchAIRecipient, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT r.id, r.batch_id, r.retailer_id, r.whatsapp_number,
		       ret.retailer_name,
		       r.ai_status, r.conversation_id,
		       r.last_event_at, r.last_event,
		       r.created_at, r.updated_at,
		       COALESCE(last_msg.content, '') AS last_content,
		       COALESCE(last_msg.role, '')    AS last_role,
		       last_msg.created_at            AS last_msg_at
		  FROM bc_batch_ai_recipients r
		  LEFT JOIN bc_retailers ret ON ret.id = r.retailer_id
		  LEFT JOIN LATERAL (
		    SELECT m.content, m.role, m.created_at
		      FROM bc_ai_conversation_messages m
		     WHERE m.admin_user_id = r.admin_user_id
		       AND m.phone = r.whatsapp_number
		     ORDER BY m.created_at DESC
		     LIMIT 1
		  ) AS last_msg ON TRUE
		 WHERE r.id = $1
		   AND r.admin_user_id = $2
	`, recipientID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var r models.BatchAIRecipient
	var lastContent, lastRole string
	var lastAt *time.Time
	if err := rows.Scan(&r.ID, &r.BatchID, &r.RetailerID, &r.WhatsappNumber,
		&r.RetailerName,
		&r.AIStatus, &r.ConversationID,
		&r.LastEventAt, &r.LastEvent,
		&r.CreatedAt, &r.UpdatedAt,
		&lastContent, &lastRole, &lastAt); err != nil {
		return nil, err
	}
	r.LastMessagePreview = lastContent
	switch lastRole {
	case "user":
		r.LastMessageDirection = "in"
	case "assistant":
		r.LastMessageDirection = "out"
	}
	r.LastMessageAt = lastAt
	return &r, nil
}

// SetBatchAIRecipientStatus flips the ai_status on a single recipient
// row. Used by the per-recipient workflow page's Exclude / Include
// actions. Admin-scoped: returns (false, nil) if the row doesn't
// exist or the caller doesn't own it.
func (s *Store) SetBatchAIRecipientStatus(ctx context.Context, adminUserID, recipientID int64, status string) (bool, error) {
	ct, err := s.DB.Exec(ctx, `
		UPDATE bc_batch_ai_recipients
		   SET ai_status = $3
		 WHERE id = $1 AND admin_user_id = $2
	`, recipientID, adminUserID, status)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

// ListBatchAIRecipientsAll returns the union of bc_batch_ai_recipients
// rows across every batch owned by adminUserID, with optional
// filters on status, batch_id, and free-text search (retailer name OR
// whatsapp_number). Returns a total count for pagination matching
// the existing AI list endpoints' shape.
//
// Admin-scoped: we hard-filter on admin_user_id at the SQL level so
// cross-tenant rows are never returned, even if a batch_id leaked
// from another tenant.
func (s *Store) ListBatchAIRecipientsAll(
	ctx context.Context,
	adminUserID int64,
	status string,
	batchID int64,
	search string,
	limit, offset int,
) ([]models.BatchAIRecipient, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	status = strings.TrimSpace(status)
	search = strings.TrimSpace(search)

	// Build the WHERE clause incrementally. We always pin
	// admin_user_id = $1 so the tenant boundary is the first filter
	// the planner sees.
	args := []any{adminUserID}
	where := []string{"r.admin_user_id = $1"}
	if status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("r.ai_status = $%d", len(args)))
	}
	if batchID > 0 {
		args = append(args, batchID)
		where = append(where, fmt.Sprintf("r.batch_id = $%d", len(args)))
	}
	if search != "" {
		// ILIKE on the phone OR on the joined retailer name. We
		// escape SQL LIKE metacharacters in the search term so a
		// stray '%' from the user doesn't widen the match.
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search) + "%"
		args = append(args, like)
		where = append(where, fmt.Sprintf(
			"(r.whatsapp_number ILIKE $%d ESCAPE '\\' OR ret.retailer_name ILIKE $%d ESCAPE '\\')",
			len(args), len(args),
		))
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	// Total count for pagination. Same WHERE, no joins, no LATERAL.
	var total int
	countSQL := "SELECT COUNT(*) FROM bc_batch_ai_recipients r " + whereSQL
	if err := s.DB.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Page query with the LATERAL preview join, identical to
	// ListBatchAIRecipients' pattern.
	args = append(args, limit, offset)
	listSQL := fmt.Sprintf(`
		SELECT r.id, r.batch_id, r.retailer_id, r.whatsapp_number,
		       ret.retailer_name,
		       r.ai_status, r.conversation_id,
		       r.last_event_at, r.last_event,
		       r.created_at, r.updated_at,
		       COALESCE(last_msg.content, '')            AS last_content,
		       COALESCE(last_msg.role, '')               AS last_role,
		       last_msg.created_at                       AS last_msg_at
		  FROM bc_batch_ai_recipients r
		  LEFT JOIN bc_retailers ret ON ret.id = r.retailer_id
		  LEFT JOIN LATERAL (
		    SELECT m.content, m.role, m.created_at
		      FROM bc_ai_conversation_messages m
		     WHERE m.admin_user_id = r.admin_user_id
		       AND m.phone = r.whatsapp_number
		     ORDER BY m.created_at DESC
		     LIMIT 1
		  ) AS last_msg ON TRUE
		 %s
		 ORDER BY r.updated_at DESC
		 LIMIT $%d OFFSET $%d
	`, whereSQL, len(args)-1, len(args))

	rows, err := s.DB.Query(ctx, listSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.BatchAIRecipient{}
	for rows.Next() {
		var r models.BatchAIRecipient
		var lastContent, lastRole string
		var lastAt *time.Time
		if err := rows.Scan(&r.ID, &r.BatchID, &r.RetailerID, &r.WhatsappNumber,
			&r.RetailerName,
			&r.AIStatus, &r.ConversationID,
			&r.LastEventAt, &r.LastEvent,
			&r.CreatedAt, &r.UpdatedAt,
			&lastContent, &lastRole, &lastAt); err != nil {
			return nil, 0, err
		}
		// Map role to direction the frontend can render. The inbox
		// schema uses "user" (retailer → us) and "assistant" (AI
		// → retailer); we surface them as "in" / "out".
		r.LastMessagePreview = lastContent
		switch lastRole {
		case "user":
			r.LastMessageDirection = "in"
		case "assistant":
			r.LastMessageDirection = "out"
		}
		r.LastMessageAt = lastAt
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// ---------- billing records ----------

// InsertBillingRecord also stamps admin_user_id so the row is owned
// consistently with its batch.
func (s *Store) InsertBillingRecord(ctx context.Context, r *models.BillingRecord) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_billing_records
		  (batch_id, admin_user_id, row_number, retailer_code, retailer_name, whatsapp_number,
		   invoice_number, billing_amount, due_date, payment_link, language,
		   raw_row, is_valid, validation_errors, retailer_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
	`,
		r.BatchID, r.AdminUserID, r.RowNumber, r.RetailerCode, r.RetailerName, r.WhatsappNumber,
		r.InvoiceNumber, r.BillingAmount, r.DueDate, r.PaymentLink, r.Language,
		r.RawRow, r.IsValid, errorsJSON(r.ValidationErrors), r.RetailerID)
}

// ListBillingRecords scopes by JOIN on bc_upload_batches.uploaded_by so
// the admin can only see rows that belong to their batches.
func (s *Store) ListBillingRecords(ctx context.Context, adminUserID, batchID int64, validOnly bool) ([]models.BillingRecord, error) {
	q := `SELECT br.id, br.admin_user_id, br.batch_id, br.row_number, br.retailer_code, br.retailer_name,
	             br.whatsapp_number, br.invoice_number, br.billing_amount, br.due_date, br.payment_link, br.language,
	             br.raw_row, br.is_valid, br.validation_errors, br.retailer_id, br.message_job_id, br.created_at
	      FROM bc_billing_records br
	      JOIN bc_upload_batches b ON b.id = br.batch_id
	      WHERE br.batch_id=$1 AND (b.uploaded_by=$2 OR b.uploaded_by IS NULL)`
	args := []any{batchID, adminUserID}
	if validOnly {
		q += ` AND br.is_valid=TRUE`
	}
	q += ` ORDER BY br.row_number ASC`
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.BillingRecord{}
	for rows.Next() {
		var (
			r        models.BillingRecord
			errsJSON []byte
		)
		if err := rows.Scan(&r.ID, &r.AdminUserID, &r.BatchID, &r.RowNumber, &r.RetailerCode, &r.RetailerName,
			&r.WhatsappNumber, &r.InvoiceNumber, &r.BillingAmount, &r.DueDate, &r.PaymentLink,
			&r.Language, &r.RawRow, &r.IsValid, &errsJSON, &r.RetailerID,
			&r.MessageJobID, &r.CreatedAt); err != nil {
			return nil, err
		}
		if len(errsJSON) > 0 {
			_ = json.Unmarshal(errsJSON, &r.ValidationErrors)
		}
		out = append(out, r)
	}
	return out, nil
}

func (s *Store) ListInvalidBillingRecords(ctx context.Context, adminUserID, batchID int64) ([]models.BillingRecord, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT br.id, br.admin_user_id, br.batch_id, br.row_number, br.retailer_code, br.retailer_name,
		       br.whatsapp_number, br.invoice_number, br.billing_amount, br.due_date, br.payment_link, br.language,
		       br.raw_row, br.is_valid, br.validation_errors, br.retailer_id, br.message_job_id, br.created_at
		FROM bc_billing_records br
		JOIN bc_upload_batches b ON b.id = br.batch_id
		WHERE br.batch_id=$1 AND br.is_valid=FALSE AND (b.uploaded_by=$2 OR b.uploaded_by IS NULL)
		ORDER BY br.row_number ASC
	`, batchID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.BillingRecord{}
	for rows.Next() {
		var (
			r        models.BillingRecord
			errsJSON []byte
		)
		if err := rows.Scan(&r.ID, &r.AdminUserID, &r.BatchID, &r.RowNumber, &r.RetailerCode, &r.RetailerName,
			&r.WhatsappNumber, &r.InvoiceNumber, &r.BillingAmount, &r.DueDate, &r.PaymentLink,
			&r.Language, &r.RawRow, &r.IsValid, &errsJSON, &r.RetailerID,
			&r.MessageJobID, &r.CreatedAt); err != nil {
			return nil, err
		}
		if len(errsJSON) > 0 {
			_ = json.Unmarshal(errsJSON, &r.ValidationErrors)
		}
		out = append(out, r)
	}
	return out, nil
}

// ---------- message jobs ----------

// CreateMessageJob stamps adminUserID so the worker can find the right
// credentials later.
func (s *Store) CreateMessageJob(ctx context.Context, j *models.MessageJob) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_message_jobs
		  (admin_user_id, batch_id, billing_record_id, retailer_id, to_number,
		   template_name, language_code, template_params, max_attempts)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, j.AdminUserID, j.BatchID, j.BillingRecordID, j.RetailerID, j.ToNumber,
		j.TemplateName, j.LanguageCode, j.TemplateParams, j.MaxAttempts)
}

func (s *Store) SetBillingRecordJob(ctx context.Context, billingID, jobID int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_billing_records SET message_job_id=$2 WHERE id=$1`, billingID, jobID)
	return err
}

func (s *Store) ListJobsByBatch(ctx context.Context, adminUserID, batchID int64) ([]models.MessageWithContext, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT j.id, j.admin_user_id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		JOIN bc_upload_batches b ON b.id = j.batch_id
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.batch_id=$1 AND (b.uploaded_by=$2 OR b.uploaded_by IS NULL) ORDER BY j.id ASC
	`, batchID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.AdminUserID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Store) ListMessages(ctx context.Context, adminUserID int64, status, search string, limit, offset int) ([]models.MessageWithContext, int, error) {
	where := `WHERE j.admin_user_id = $1`
	args := []any{adminUserID}
	if status != "" {
		args = append(args, status)
		where += " AND j.status=$" + itoa(len(args))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		where += " AND (r.retailer_name ILIKE $" + itoa(len(args)) + " OR j.to_number ILIKE $" + itoa(len(args)) + ")"
	}
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_message_jobs j LEFT JOIN bc_retailers r ON r.id=j.retailer_id "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	q := `
		SELECT j.id, j.admin_user_id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		` + where + ` ORDER BY j.id DESC LIMIT $` + itoa(len(args)-1) + ` OFFSET $` + itoa(len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.AdminUserID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}

func (s *Store) GetMessage(ctx context.Context, adminUserID, id int64) (*models.MessageWithContext, []models.StatusEvent, error) {
	var m models.MessageWithContext
	err := s.DB.QueryRow(ctx, `
		SELECT j.id, j.admin_user_id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.id=$1 AND j.admin_user_id=$2
	`, id, adminUserID).Scan(&m.ID, &m.AdminUserID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
		&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
		&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
		&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
		&m.RetailerName, &m.InvoiceNumber, &m.Amount)
	if err == pgx.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, message_job_id, provider_msg_id, status, reason_code, reason_text, raw_payload, occurred_at
		FROM bc_message_status_events WHERE message_job_id=$1 ORDER BY occurred_at ASC
	`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	evs := []models.StatusEvent{}
	for rows.Next() {
		var e models.StatusEvent
		if err := rows.Scan(&e.ID, &e.MessageJobID, &e.ProviderMsgID, &e.Status, &e.ReasonCode, &e.ReasonText, &e.RawPayload, &e.OccurredAt); err != nil {
			return nil, nil, err
		}
		evs = append(evs, e)
	}
	return &m, evs, nil
}

// MarkJobStatus is called by both the worker and the webhook. The
// adminUserID is used to authorise the update: the caller must own
// the job (or it must be legacy / NULL-owned). Returns pgx.ErrNoRows
// if the job doesn't exist OR isn't owned by the caller.
func (s *Store) MarkJobStatus(ctx context.Context, adminUserID, id int64, status string, providerMsgID, lastErr *string) error {
	col := ""
	switch status {
	case "sending":
		col = ""
	case "sent":
		col = ", sent_at=now()"
	case "delivered":
		col = ", delivered_at=COALESCE(delivered_at, now())"
	case "read":
		col = ", read_at=COALESCE(read_at, now())"
	case "failed":
		col = ", failed_at=now()"
	}
	q := `UPDATE bc_message_jobs SET status=$3, provider_msg_id=COALESCE($4, provider_msg_id), last_error=$5, attempts=attempts+1` + col +
		` WHERE id=$1 AND admin_user_id=$2`
	ct, err := s.DB.Exec(ctx, q, id, adminUserID, status, providerMsgID, lastErr)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) InsertStatusEvent(ctx context.Context, jobID int64, providerMsgID, status, reasonCode, reasonText *string, raw []byte) error {
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_message_status_events (message_job_id, provider_msg_id, status, reason_code, reason_text, raw_payload)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, jobID, providerMsgID, status, reasonCode, reasonText, raw)
	return err
}

// ResetJobForRetry flips a failed (or stuck) job back to queued. The
// adminUserID guard prevents Admin A from resending Admin B's job by
// guessing the id — the WHERE filter means the UPDATE is a no-op if
// the job doesn't belong to them.
//
// Status guard:
//   - queued / failed / sending -> reset to queued, attempts++, last_error=NULL
//   - sent / delivered / read    -> 400 (no double-send)
//   - anything else              -> 400
func (s *Store) ResetJobForRetry(ctx context.Context, adminUserID, id int64) (*models.MessageJob, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var (
		status  string
		ownerID *int64
	)
	if err := tx.QueryRow(ctx,
		`SELECT status, admin_user_id FROM bc_message_jobs WHERE id=$1 FOR UPDATE`, id,
	).Scan(&status, &ownerID); err != nil {
		return nil, err
	}
	// ownership: caller must be the owner OR the row must be legacy (NULL owner).
	if ownerID != nil && adminUserID > 0 && *ownerID != adminUserID {
		return nil, pgx.ErrNoRows
	}
	switch status {
	case "queued", "failed", "sending":
		// ok
	case "sent", "delivered", "read":
		return nil, fmt.Errorf("cannot resend: already %s", status)
	default:
		return nil, fmt.Errorf("cannot resend: invalid status %q", status)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bc_message_jobs
		SET status='queued', last_error=NULL, attempts=attempts+1, failed_at=NULL
		WHERE id=$1
	`, id); err != nil {
		return nil, err
	}

	var j models.MessageJob
	if err := tx.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs WHERE id=$1
	`, id).Scan(&j.ID, &j.AdminUserID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &j, nil
}

// ResetManyFailedForRetry bulk-resets failed jobs. When batchID > 0,
// only resets within that batch; otherwise all failed jobs owned by
// the admin. Both modes skip legacy (NULL-owned) jobs unless
// adminUserID == 0 (system context — not exposed via HTTP).
func (s *Store) ResetManyFailedForRetry(ctx context.Context, adminUserID, batchID int64) ([]models.MessageJob, error) {
	where := "j.status='failed'"
	args := []any{}
	if adminUserID > 0 {
		args = append(args, adminUserID)
		where += " AND j.admin_user_id=$1"
	}
	if batchID > 0 {
		args = append(args, batchID)
		where += " AND j.batch_id=$" + itoa(len(args))
	}
	rows, err := s.DB.Query(ctx, `SELECT j.id FROM bc_message_jobs j WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	out := []models.MessageJob{}
	for _, id := range ids {
		j, err := s.ResetJobForRetry(ctx, adminUserID, id)
		if err != nil {
			continue
		}
		out = append(out, *j)
	}
	return out, nil
}

func (s *Store) FindJobByProviderMsgID(ctx context.Context, provID string) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, billing_record_id, retailer_id, to_number, template_name, language_code,
		       template_params, status, attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs WHERE provider_msg_id=$1
	`, provID).Scan(&j.ID, &j.AdminUserID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber, &j.TemplateName, &j.LanguageCode,
		&j.TemplateParams, &j.Status, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// ---------- retailer history ----------

// RetailerHistory returns recent messages for a single retailer, scoped
// to the calling admin (or legacy NULL-owned rows).
func (s *Store) RetailerHistory(ctx context.Context, adminUserID, retailerID int64, limit int) ([]models.MessageWithContext, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT j.id, j.admin_user_id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.retailer_id=$1 AND j.admin_user_id=$2
		ORDER BY j.id DESC LIMIT $3
	`, retailerID, adminUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.AdminUserID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// ---------- templates ----------

func (s *Store) ListTemplates(ctx context.Context, adminUserID int64) ([]models.Template, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates
		WHERE admin_user_id=$1
		ORDER BY id ASC
	`, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Template{}
	for rows.Next() {
		var t models.Template
		if err := rows.Scan(&t.ID, &t.AdminUserID, &t.Name, &t.LanguageCode, &t.Category, &t.Body,
			&t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *Store) CreateTemplate(ctx context.Context, t *models.Template) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_templates
		  (admin_user_id, name, language_code, category, body, variable_count, sample_payload, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, t.AdminUserID, t.Name, t.LanguageCode, t.Category, t.Body, t.VariableCount, t.SamplePayload, t.IsActive)
}

// GetActiveTemplate is used by the approve-batch path; the approval
// picks the template by (name, lang) and is scoped to the calling
// admin (with NULL-owner fallback so legacy templates stay usable).
func (s *Store) GetActiveTemplate(ctx context.Context, adminUserID int64, name, lang string) (*models.Template, error) {
	var t models.Template
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates
		WHERE name=$1 AND language_code=$2 AND is_active=TRUE
		  AND admin_user_id=$3
		ORDER BY (admin_user_id = $3) DESC  -- prefer the caller's own template
		LIMIT 1
	`, name, lang, adminUserID).Scan(&t.ID, &t.AdminUserID, &t.Name, &t.LanguageCode, &t.Category, &t.Body,
		&t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) GetTemplateByID(ctx context.Context, adminUserID, id int64) (*models.Template, error) {
	var t models.Template
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates
		WHERE id=$1 AND admin_user_id=$2
	`, id, adminUserID).Scan(&t.ID, &t.AdminUserID, &t.Name, &t.LanguageCode, &t.Category, &t.Body,
		&t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) UpdateTemplate(ctx context.Context, t *models.Template) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_templates
		SET name=$1, language_code=$2, category=$3, body=$4,
		    variable_count=$5, sample_payload=$6, is_active=$7
		WHERE id=$8 AND admin_user_id=$9
	`, t.Name, t.LanguageCode, t.Category, t.Body, t.VariableCount, t.SamplePayload, t.IsActive, t.ID, t.AdminUserID)
	return err
}

func (s *Store) SetTemplateActive(ctx context.Context, adminUserID, id int64, active bool) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_templates SET is_active=$1
		WHERE id=$2 AND admin_user_id=$3
	`, active, id, adminUserID)
	return err
}

func (s *Store) DeleteTemplate(ctx context.Context, adminUserID, id int64) error {
	_, err := s.DB.Exec(ctx,
		`DELETE FROM bc_templates WHERE id=$1 AND admin_user_id=$2`,
		id, adminUserID)
	return err
}

// ---------- dashboard ----------

// KPIs counts the admin's retailers, opt-outs, and today's messages.
func (s *Store) KPIs(ctx context.Context, adminUserID int64) (models.DashboardKPI, error) {
	var k models.DashboardKPI
	err := s.DB.QueryRow(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM bc_retailers WHERE admin_user_id=$1),
		  (SELECT COUNT(*) FROM bc_retailers WHERE is_opted_out=TRUE AND admin_user_id=$1)
	`, adminUserID).Scan(&k.TotalRetailers, &k.OptedOutRetailers)
	if err != nil {
		return k, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT status, COUNT(*) FROM bc_message_jobs
		WHERE created_at::date = CURRENT_DATE
		  AND admin_user_id=$1
		GROUP BY status
	`, adminUserID)
	if err != nil {
		return k, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return k, err
		}
		k.MessagesToday += n
		switch st {
		case "delivered", "read":
			k.DeliveredToday += n
			if st == "read" {
				k.ReadToday += n
			}
		case "failed":
			k.FailedToday += n
		}
	}
	if k.MessagesToday > 0 {
		k.DeliveryRateToday = float64(k.DeliveredToday) / float64(k.MessagesToday) * 100
		k.ReadRateToday = float64(k.ReadToday) / float64(k.MessagesToday) * 100
	}
	return k, nil
}

func (s *Store) DailyTrend(ctx context.Context, adminUserID int64, days int) ([]models.DailyTrendPoint, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT to_char(d.day,'YYYY-MM-DD') AS d,
		       COUNT(*) FILTER (WHERE j.status IN ('sent','delivered','read')) AS sent,
		       COUNT(*) FILTER (WHERE j.status IN ('delivered','read')) AS delivered,
		       COUNT(*) FILTER (WHERE j.status='read') AS read,
		       COUNT(*) FILTER (WHERE j.status='failed') AS failed
		FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day') AS d(day)
		LEFT JOIN bc_message_jobs j
		  ON j.created_at::date = d.day
		  AND j.admin_user_id=$2
		GROUP BY d.day ORDER BY d.day ASC
	`, days, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.DailyTrendPoint{}
	for rows.Next() {
		var p models.DailyTrendPoint
		if err := rows.Scan(&p.Date, &p.Sent, &p.Delivered, &p.Read, &p.Failed); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ---------- reports ----------

func (s *Store) ReportSummary(ctx context.Context, adminUserID int64, from, to time.Time) (map[string]int, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT status, COUNT(*) FROM bc_message_jobs
		WHERE created_at BETWEEN $1 AND $2
		  AND admin_user_id=$3
		GROUP BY status
	`, from, to, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{
		"sent": 0, "delivered": 0, "read": 0, "failed": 0, "queued": 0, "sending": 0,
	}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, nil
}

// ReportsTrend returns one bucket per day in [from, to] for the admin.
func (s *Store) ReportsTrend(ctx context.Context, adminUserID int64, from, to time.Time) ([]models.DailyTrendPoint, error) {
	rows, err := s.DB.Query(ctx, `
		WITH days AS (
			SELECT generate_series(
				date_trunc('day', $1::timestamptz),
				date_trunc('day', $2::timestamptz),
				interval '1 day'
			) AS day
		),
		buckets AS (
			SELECT
				date_trunc('day', created_at)::date  AS d,
				COUNT(*) FILTER (WHERE created_at   IS NOT NULL) AS sent,
				COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
				COUNT(*) FILTER (WHERE read_at      IS NOT NULL) AS read,
				COUNT(*) FILTER (WHERE failed_at    IS NOT NULL) AS failed
			FROM bc_message_jobs
			WHERE created_at >= $1::timestamptz
			  AND created_at <  ($2::timestamptz + interval '1 day')
			  AND admin_user_id=$3
			GROUP BY 1
		)
		SELECT
			to_char(days.day, 'YYYY-MM-DD') AS date,
			COALESCE(b.sent,      0)::int,
			COALESCE(b.delivered, 0)::int,
			COALESCE(b.read,      0)::int,
			COALESCE(b.failed,    0)::int
		FROM days
		LEFT JOIN buckets b ON b.d = days.day
		ORDER BY days.day
	`, from, to, adminUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.DailyTrendPoint{}
	for rows.Next() {
		var p models.DailyTrendPoint
		if err := rows.Scan(&p.Date, &p.Sent, &p.Delivered, &p.Read, &p.Failed); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ---------- audit ----------

// RecentAudit returns the admin's own actions plus any system-level
// actions (actor_id IS NULL) that all admins should see. Pass
// entityType/entityID to filter to a specific record (used by the
// per-recipient History panel); pass empty/zero to disable filtering.
func (s *Store) RecentAudit(ctx context.Context, adminUserID int64, limit int, entityType string, entityID int64) ([]models.AuditLog, error) {
	args := []any{adminUserID, limit}
	q := `SELECT id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at
		FROM bc_audit_logs
		WHERE (actor_id = $1 OR actor_id IS NULL)`
	if entityType != "" && entityID > 0 {
		args = append(args, entityType, entityID)
		q += fmt.Sprintf(" AND entity_type = $%d AND entity_id = $%d", len(args)-1, len(args))
	}
	q += " ORDER BY id DESC LIMIT $2"
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AuditLog{}
	for rows.Next() {
		var a models.AuditLog
		if err := rows.Scan(&a.ID, &a.ActorID, &a.ActorEmail, &a.Action, &a.EntityType, &a.EntityID, &a.Metadata, &a.IPAddress, &a.UserAgent, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// ---------- helpers ----------

func (s *Store) insertReturningID(ctx context.Context, q string, args ...any) (int64, error) {
	q = q + " RETURNING id"
	var id int64
	if err := s.DB.QueryRow(ctx, q, args...).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func errorsJSON(errs []models.ValidationError) []byte {
	if len(errs) == 0 {
		return nil
	}
	b, _ := json.Marshal(errs)
	return b
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// previewFromParams renders a short human-readable preview from a job's
// stored template_params. Used for the conversation-list row.
func previewFromParams(j *models.MessageJob) string {
	if len(j.TemplateParams) == 0 {
		return j.TemplateName
	}
	var params []string
	if err := json.Unmarshal(j.TemplateParams, &params); err != nil {
		return j.TemplateName
	}
	parts := make([]string, 0, len(params))
	for _, p := range params {
		if strings.TrimSpace(p) == "" {
			continue
		}
		parts = append(parts, p)
	}
	body := strings.Join(parts, " ")
	if len(body) > 80 {
		body = body[:77] + "…"
	}
	return body
}

// ---------- conversations (chat view) ----------

// ListConversations groups bc_message_jobs by retailer_id (with a phone-only
// fallback for unlinked messages) and returns one row per group, newest first.
func (s *Store) ListConversations(ctx context.Context, adminUserID int64, search string, limit, offset int) ([]models.Conversation, int, error) {
	args := []any{adminUserID}
	searchWhere := ""
	if search != "" {
		args = append(args, "%"+search+"%")
		idx := itoa(len(args))
		searchWhere = `WHERE retailer_name ILIKE $` + idx + ` OR phone ILIKE $` + idx
	}

	conversationListCTE := `
		WITH source_rows AS (
			SELECT
				j.to_number AS phone,
				j.retailer_id,
				COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at,
				1::int AS msg_count,
				(j.status = 'failed') AS has_failed
			FROM bc_message_jobs j
			WHERE j.admin_user_id = $1
			  AND trim(COALESCE(j.to_number, '')) <> ''

			UNION ALL

			SELECT
				st.phone,
				st.retailer_id,
				COALESCE(st.last_message_at, st.updated_at, st.started_at) AS occurred_at,
				0::int AS msg_count,
				FALSE AS has_failed
			FROM bc_ai_conversation_states st
			WHERE st.admin_user_id = $1
			  AND trim(COALESCE(st.phone, '')) <> ''

			UNION ALL

			SELECT
				m.phone,
				NULL::bigint AS retailer_id,
				m.created_at AS occurred_at,
				1::int AS msg_count,
				(m.send_status = 'failed') AS has_failed
			FROM bc_ai_conversation_messages m
			WHERE m.admin_user_id = $1
			  AND trim(COALESCE(m.phone, '')) <> ''
		),
		grouped AS (
			SELECT
				phone,
				MAX(retailer_id) FILTER (WHERE retailer_id IS NOT NULL) AS retailer_id,
				MAX(occurred_at) AS last_at,
				SUM(msg_count)::int AS cnt,
				BOOL_OR(has_failed) AS has_failed
			FROM source_rows
			GROUP BY phone
		),
		named AS (
			SELECT
				grouped.retailer_id,
				grouped.phone,
				COALESCE(r.retailer_name, rp.retailer_name, '(unknown)') AS retailer_name,
				grouped.last_at,
				grouped.cnt,
				grouped.has_failed
			FROM grouped
			LEFT JOIN bc_retailers r ON r.id = grouped.retailer_id
			LEFT JOIN LATERAL (
				SELECT rr.retailer_name
				FROM bc_retailers rr
				WHERE rr.admin_user_id = $1
				  AND regexp_replace(rr.whatsapp_number, '[^0-9]', '', 'g') = regexp_replace(grouped.phone, '[^0-9]', '', 'g')
				ORDER BY rr.id DESC
				LIMIT 1
			) rp ON grouped.retailer_id IS NULL
		)
	`

	var total int
	if err := s.DB.QueryRow(ctx, conversationListCTE+`
		SELECT COUNT(*) FROM named
		`+searchWhere+`
	`, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	limitIdx := itoa(len(args) - 1)
	offsetIdx := itoa(len(args))
	rows, err := s.DB.Query(ctx, conversationListCTE+`
		SELECT retailer_id, phone, retailer_name, last_at, cnt, has_failed
		FROM named
		`+searchWhere+`
		ORDER BY last_at DESC
		LIMIT $`+limitIdx+` OFFSET $`+offsetIdx+`
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []models.Conversation{}
	for rows.Next() {
		var c models.Conversation
		if err := rows.Scan(&c.RetailerID, &c.Phone, &c.RetailerName, &c.LastMessageAt, &c.MessageCount, &c.HasFailed); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}

	// Fill last_preview, last_status, last_direction from the latest job per conversation.
	for i := range out {
		c := &out[i]
		var (
			j       *models.MessageJob
			inbound *inboundPreview
			err     error
		)
		if c.RetailerID != nil {
			j, err = s.latestJobForRetailer(ctx, adminUserID, *c.RetailerID)
			inbound, _ = s.latestInboundForRetailer(ctx, adminUserID, *c.RetailerID)
		} else {
			j, err = s.latestJobForPhone(ctx, adminUserID, c.Phone)
			inbound, _ = s.latestInboundForPhone(ctx, adminUserID, c.Phone)
		}
		if err != nil {
			continue
		}

		if j != nil {
			c.LastStatus = j.Status
			c.LastDirection = "outbound"
			c.LastPreview = previewFromParams(j)
			c.LastMessageAt = jobMessageTime(j)
		}

		// Linked replies are stored in bc_message_status_events, not as a new
		// job row. If a retailer replied after our latest outbound, make the
		// conversation row show that inbound message and move it to the top.
		if inbound != nil && (j == nil || !inbound.OccurredAt.Before(c.LastMessageAt)) {
			c.LastMessageAt = inbound.OccurredAt
			c.LastStatus = "received"
			c.LastDirection = "inbound"
			c.LastPreview = trimPreview(inbound.Body)
		}
		if humanCount, localPreview, localAt, err := s.aiConversationLocalStats(ctx, adminUserID, "phone:"+c.Phone); err == nil {
			c.MessageCount += humanCount
			if localAt != nil && localAt.After(c.LastMessageAt) {
				c.LastMessageAt = *localAt
				c.LastStatus = "ai"
				c.LastDirection = "outbound"
				c.LastPreview = localPreview
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].LastMessageAt.After(out[j].LastMessageAt)
	})
	return out, total, nil
}

// latestInboundBody returns the body of the most recent received status event
// for a job (used to populate the conversation-list preview for inbound).
func (s *Store) latestInboundBody(ctx context.Context, jobID int64) (string, error) {
	var body *string
	err := s.DB.QueryRow(ctx, `
		SELECT reason_text FROM bc_message_status_events
		WHERE message_job_id = $1 AND status = 'received'
		ORDER BY occurred_at DESC LIMIT 1
	`, jobID).Scan(&body)
	if err != nil || body == nil {
		return "", err
	}
	text := *body
	if len(text) > 80 {
		text = text[:77] + "…"
	}
	return text, nil
}

type inboundPreview struct {
	Body       string
	OccurredAt time.Time
}

func (s *Store) latestInboundForRetailer(ctx context.Context, adminUserID, retailerID int64) (*inboundPreview, error) {
	var p inboundPreview
	err := s.DB.QueryRow(ctx, `
		SELECT COALESCE(e.reason_text, '') AS body, e.occurred_at
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.retailer_id = $1
		  AND j.admin_user_id=$2
		  AND e.status = 'received'
		ORDER BY e.occurred_at DESC
		LIMIT 1
	`, retailerID, adminUserID).Scan(&p.Body, &p.OccurredAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) latestInboundForPhone(ctx context.Context, adminUserID int64, phone string) (*inboundPreview, error) {
	var p inboundPreview
	err := s.DB.QueryRow(ctx, `
		SELECT COALESCE(e.reason_text, '') AS body, e.occurred_at
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.to_number = $1
		  AND j.admin_user_id=$2
		  AND e.status = 'received'
		ORDER BY e.occurred_at DESC
		LIMIT 1
	`, phone, adminUserID).Scan(&p.Body, &p.OccurredAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func trimPreview(text string) string {
	if len(text) > 80 {
		text = text[:77] + "..."
	}
	return text
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func jobMessageTime(j *models.MessageJob) time.Time {
	switch {
	case j.SentAt != nil:
		return *j.SentAt
	case j.DeliveredAt != nil:
		return *j.DeliveredAt
	case j.ReadAt != nil:
		return *j.ReadAt
	case j.FailedAt != nil:
		return *j.FailedAt
	default:
		return j.QueuedAt
	}
}

func (s *Store) latestJobForRetailer(ctx context.Context, adminUserID, retailerID int64) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs
		WHERE retailer_id=$1 AND admin_user_id=$2
		ORDER BY COALESCE(sent_at, delivered_at, read_at, failed_at, queued_at, created_at) DESC
		LIMIT 1`, retailerID, adminUserID,
	).Scan(&j.ID, &j.AdminUserID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &j, err
}

func (s *Store) latestJobForPhone(ctx context.Context, adminUserID int64, phone string) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs
		WHERE to_number=$1
		  AND admin_user_id=$2
		ORDER BY COALESCE(sent_at, delivered_at, read_at, failed_at, queued_at, created_at) DESC
		LIMIT 1`, phone, adminUserID,
	).Scan(&j.ID, &j.AdminUserID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &j, err
}

// ListConversationMessages returns the merged outbound + inbound thread for
// one retailer, oldest first. Scoped to the calling admin (or legacy rows).
func (s *Store) ListConversationMessages(ctx context.Context, adminUserID, retailerID int64, limit, offset int) ([]models.ThreadMessage, error) {
	outRows, err := s.DB.Query(ctx, `
		SELECT j.id, j.template_name, j.language_code, j.status,
		       j.last_error, j.provider_msg_id, j.billing_record_id,
		       j.template_params,
		       COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at,
		       br.invoice_number, br.billing_amount, t.body AS template_body
		FROM bc_message_jobs j
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		LEFT JOIN bc_templates t ON t.name = j.template_name AND t.language_code = j.language_code
		WHERE j.retailer_id = $1
		  AND j.admin_user_id=$2
		  AND j.status <> 'received'
		  AND j.batch_id <> 0
		ORDER BY occurred_at ASC
	`, retailerID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer outRows.Close()

	out := []models.ThreadMessage{}
	for outRows.Next() {
		var (
			id           int64
			tplName      string
			lang         string
			status       string
			lastErr      *string
			provID       *string
			brID         *int64
			tplParams    []byte
			occurredAt   time.Time
			inv          *string
			amount       *float64
			templateBody *string
		)
		if err := outRows.Scan(&id, &tplName, &lang, &status, &lastErr, &provID, &brID,
			&tplParams, &occurredAt, &inv, &amount, &templateBody); err != nil {
			return nil, err
		}

		// Render the bubble body: substitute stored params into the template body.
		body := renderOutboundBody(templateBody, tplParams, inv, amount, occurredAt)

		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "outbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurredAt,
			TemplateName:  tplName,
			LanguageCode:  lang,
			LastError:     lastErr,
			ProviderMsgID: provID,
			InvoiceNumber: inv,
			Amount:        amount,
			MessageJobID:  id,
		})
	}

	// Fetch inbound (status events with status='received') for jobs belonging
	// to this retailer.
	inRows, err := s.DB.Query(ctx, `
		SELECT e.id, e.message_job_id, COALESCE(e.reason_text, '') AS body,
		       e.status, e.occurred_at, e.provider_msg_id
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.retailer_id = $1
		  AND j.admin_user_id=$2
		  AND e.status = 'received'
		ORDER BY e.occurred_at ASC
	`, retailerID, adminUserID)
	if err != nil {
		return nil, err
	}
	defer inRows.Close()

	for inRows.Next() {
		var (
			id       int64
			msgJobID int64
			body     string
			status   string
			occurred time.Time
			provID   *string
		)
		if err := inRows.Scan(&id, &msgJobID, &body, &status, &occurred, &provID); err != nil {
			return nil, err
		}
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "inbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurred,
			ProviderMsgID: provID,
			MessageJobID:  msgJobID,
		})
	}

	// CRITICAL: merge the two lists chronologically.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].OccurredAt.Equal(out[j].OccurredAt) {
			if out[i].Direction != out[j].Direction {
				return out[i].Direction == "outbound"
			}
			return out[i].ID < out[j].ID
		}
		return out[i].OccurredAt.Before(out[j].OccurredAt)
	})

	if offset >= len(out) {
		return []models.ThreadMessage{}, nil
	}
	end := offset + limit
	if end > len(out) {
		end = len(out)
	}
	return out[offset:end], nil
}

// substituteDefaults is the same default {{N}} mapping used by the worker
// when sending, so the chat preview shows what was actually delivered.
func substituteDefaults(body string, invoice *string, amount *float64, occurredAt time.Time) string {
	inv := ""
	if invoice != nil {
		inv = *invoice
	}
	amt := ""
	if amount != nil {
		amt = fmt.Sprintf("%.2f", *amount)
	}
	date := occurredAt.Format("2006-01-02")
	name := ""
	period := date
	due := date
	contact := "support@itc.example"

	repls := []struct{ old, new string }{
		{"{{1}}", name},
		{"{{2}}", period},
		{"{{3}}", inv},
		{"{{4}}", amt},
		{"{{5}}", due},
		{"{{6}}", contact},
	}
	for _, r := range repls {
		body = strings.ReplaceAll(body, r.old, r.new)
	}
	return body
}

// renderOutboundBody produces the bubble text for an outbound message —
// exactly what was sent to Meta (and what the retailer sees on their phone).
func renderOutboundBody(templateBody *string, tplParams []byte, invoice *string, amount *float64, occurredAt time.Time) string {
	var params []string
	if len(tplParams) > 0 {
		_ = json.Unmarshal(tplParams, &params)
	}

	if templateBody != nil && *templateBody != "" && len(params) > 0 {
		body := *templateBody
		for i, p := range params {
			body = strings.ReplaceAll(body, fmt.Sprintf("{{%d}}", i+1), p)
		}
		return body
	}

	if templateBody != nil && *templateBody != "" {
		return substituteDefaults(*templateBody, invoice, amount, occurredAt)
	}

	if len(params) > 0 {
		return composeFromParams(params)
	}

	if invoice != nil || amount != nil {
		parts := []string{}
		if invoice != nil {
			parts = append(parts, "Invoice: "+*invoice)
		}
		if amount != nil {
			parts = append(parts, fmt.Sprintf("Amount: INR %.2f", *amount))
		}
		return strings.Join(parts, "\n")
	}

	return "Message sent."
}

func composeFromParams(params []string) string {
	parts := make([]string, 0, len(params))
	for _, p := range params {
		if strings.TrimSpace(p) == "" {
			continue
		}
		parts = append(parts, p)
	}
	if len(parts) == 0 {
		return "Hello from WhatsyITC."
	}
	switch {
	case len(parts) >= 6:
		return fmt.Sprintf(
			"Hello %s, your billing summary for %s.\n\nInvoice: %s\nAmount: INR %s\nDue Date: %s\n\nFor billing queries, contact %s.",
			parts[0], parts[1], parts[2], parts[3], parts[4], parts[5],
		)
	case len(parts) >= 2:
		return "Hello " + parts[0] + ",\n\n" + strings.Join(parts[1:], "\n")
	default:
		return strings.Join(parts, "\n")
	}
}

// ConversationStorer is the surface the handlers depend on. Defined here so
// the conversations handlers can compile against the interface and we get a
// compile-time error if a method is missing.
type ConversationStorer interface {
	ListConversations(ctx context.Context, adminUserID int64, search string, limit, offset int) ([]models.Conversation, int, error)
	ListConversationMessages(ctx context.Context, adminUserID, retailerID int64, limit, offset int) ([]models.ThreadMessage, error)
	ListConversationMessagesByPhone(ctx context.Context, adminUserID int64, phone string, limit, offset int) ([]models.ThreadMessage, error)
}

func (s *Store) ListConversationMessagesByPhone(ctx context.Context, adminUserID int64, phone string, limit, offset int) ([]models.ThreadMessage, error) {
	outRows, err := s.DB.Query(ctx, `
		SELECT j.id, j.template_name, j.language_code, j.status,
		       j.last_error, j.provider_msg_id, j.billing_record_id,
		       j.template_params,
		       COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at,
		       br.invoice_number, br.billing_amount, t.body AS template_body
		FROM bc_message_jobs j
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		LEFT JOIN bc_templates t ON t.name = j.template_name AND t.language_code = j.language_code
		WHERE j.to_number = $1
		  AND j.admin_user_id=$2
		  AND j.status <> 'received'
		  AND j.batch_id <> 0
		ORDER BY occurred_at ASC
	`, phone, adminUserID)
	if err != nil {
		return nil, err
	}
	defer outRows.Close()

	out := []models.ThreadMessage{}
	for outRows.Next() {
		var (
			id           int64
			tplName      string
			lang         string
			status       string
			lastErr      *string
			provID       *string
			brID         *int64
			tplParams    []byte
			occurredAt   time.Time
			inv          *string
			amount       *float64
			templateBody *string
		)
		if err := outRows.Scan(&id, &tplName, &lang, &status, &lastErr, &provID, &brID,
			&tplParams, &occurredAt, &inv, &amount, &templateBody); err != nil {
			return nil, err
		}
		body := renderOutboundBody(templateBody, tplParams, inv, amount, occurredAt)
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "outbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurredAt,
			TemplateName:  tplName,
			LanguageCode:  lang,
			LastError:     lastErr,
			ProviderMsgID: provID,
			InvoiceNumber: inv,
			Amount:        amount,
			MessageJobID:  id,
		})
	}

	inRows, err := s.DB.Query(ctx, `
		SELECT e.id, e.message_job_id, COALESCE(e.reason_text, '') AS body,
		       e.status, e.occurred_at, e.provider_msg_id
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.to_number = $1
		  AND j.admin_user_id=$2
		  AND e.status = 'received'
		ORDER BY e.occurred_at ASC
	`, phone, adminUserID)
	if err != nil {
		return nil, err
	}
	defer inRows.Close()

	for inRows.Next() {
		var (
			id       int64
			msgJobID int64
			body     string
			status   string
			occurred time.Time
			provID   *string
		)
		if err := inRows.Scan(&id, &msgJobID, &body, &status, &occurred, &provID); err != nil {
			return nil, err
		}
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "inbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurred,
			ProviderMsgID: provID,
			MessageJobID:  msgJobID,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].OccurredAt.Equal(out[j].OccurredAt) {
			if out[i].Direction != out[j].Direction {
				return out[i].Direction == "outbound"
			}
			return out[i].ID < out[j].ID
		}
		return out[i].OccurredAt.Before(out[j].OccurredAt)
	})

	if offset >= len(out) {
		return []models.ThreadMessage{}, nil
	}
	end := offset + limit
	if end > len(out) {
		end = len(out)
	}
	return out[offset:end], nil
}

// CreateOrphanInboundJob persists an inbound text message from a retailer
// that has no prior outbound on our side. adminUserID is the resolved
// owner (looked up from the webhook payload; 0 means "couldn't attribute").
func (s *Store) CreateOrphanInboundJob(ctx context.Context, adminUserID int64, phone, body, timestamp string) (int64, error) {
	occurredAt := time.Now()
	if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil && ts > 0 {
		occurredAt = time.Unix(ts, 0)
	}

	// Resolve retailer: match by normalized digits first so inbound replies
	// do not create duplicate "(unknown)" conversations. Limit the search
	// to the caller's own rows + legacy (NULL-owned) rows.
	var retailerID int64
	var err error
	normalizedPhone := onlyDigits(phone)
	if normalizedPhone != "" {
		if adminUserID > 0 {
			err = s.DB.QueryRow(ctx, `
				SELECT id
				FROM bc_retailers
				WHERE regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = $1
				  AND admin_user_id = $2
				ORDER BY id
				LIMIT 1
			`, normalizedPhone, adminUserID).Scan(&retailerID)
		} else {
			err = s.DB.QueryRow(ctx, `
				SELECT id
				FROM bc_retailers
				WHERE regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = $1
				ORDER BY id
				LIMIT 1
			`, normalizedPhone).Scan(&retailerID)
		}
		if err != nil && err != pgx.ErrNoRows {
			return 0, err
		}
	}
	if retailerID == 0 {
		if adminUserID > 0 {
			err = s.DB.QueryRow(ctx, `
				INSERT INTO bc_retailers
					(admin_user_id, retailer_code, whatsapp_number, retailer_name, is_opted_out)
				VALUES ($1, 'orphan-' || md5($1::text || ':' || $2), $2, '(unknown)', FALSE)
				ON CONFLICT (admin_user_id, whatsapp_number) WHERE admin_user_id IS NOT NULL
				DO UPDATE SET
					whatsapp_number = EXCLUDED.whatsapp_number,
					updated_at = now()
				RETURNING id
			`, adminUserID, phone).Scan(&retailerID)
		} else {
			err = s.DB.QueryRow(ctx, `
				INSERT INTO bc_retailers
					(retailer_code, whatsapp_number, retailer_name, is_opted_out)
				VALUES ('orphan-' || md5($1 || ':' || random()::text), $1, '(unknown)', FALSE)
				RETURNING id
			`, phone).Scan(&retailerID)
		}
		if err != nil {
			return 0, err
		}
	}

	const orphanBatchID int64 = -1
	var batchUploader any
	if adminUserID > 0 {
		batchUploader = adminUserID
	}
	_, err = s.DB.Exec(ctx, `
		INSERT INTO bc_upload_batches
			(id, file_name, file_path, file_size_bytes, mime_type,
			 uploaded_by, total_rows, valid_rows, status, notes)
		VALUES ($1, 'orphan-inbound', '', 0, 'system/x-orphan',
			$2, 0, 0, 'system', 'synthetic batch for inbound-only messages')
		ON CONFLICT (id) DO NOTHING
	`, orphanBatchID, batchUploader)
	if err != nil {
		return 0, err
	}
	batchID := orphanBatchID

	var adminArg any
	if adminUserID > 0 {
		adminArg = adminUserID
	}
	var billingRecordID int64
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_billing_records
			(batch_id, admin_user_id, row_number, retailer_id, whatsapp_number, is_valid, validation_errors, raw_row)
		VALUES ($1, $2, 0, $3, $4, TRUE, '[]'::jsonb, '{}'::jsonb)
		RETURNING id
	`, batchID, adminArg, retailerID, phone).Scan(&billingRecordID)
	if err != nil {
		return 0, err
	}

	var jobID int64
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_message_jobs
			(admin_user_id, batch_id, billing_record_id, retailer_id, to_number,
			 template_name, language_code, status, attempts, max_attempts, queued_at)
		VALUES ($1, $2, $3, $4, $5, '', '', 'received', 0, 1, $6)
		RETURNING id
	`, adminArg, batchID, billingRecordID, retailerID, phone, occurredAt).Scan(&jobID)
	if err != nil {
		return 0, err
	}

	receivedStatus := "received"
	_ = s.InsertStatusEvent(ctx, jobID, nil, &receivedStatus, nil, &body, []byte(`{"source":"orphan-inbound"}`))

	return jobID, nil
}

// UpdateRetailerNameByPhone upgrades the placeholder retailer name.
func (s *Store) UpdateRetailerNameByPhone(ctx context.Context, phone, name string) error {
	normalizedPhone := onlyDigits(phone)
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_retailers
		SET retailer_name = $2
		WHERE retailer_name = '(unknown)'
		  AND (
		    whatsapp_number = $1
		    OR ($3 <> '' AND regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = $3)
		  )
	`, phone, name, normalizedPhone)
	return err
}

// ---------- webhook log ----------

// InsertWebhookLog records a single inbound webhook payload. adminUserID
// is the admin we attributed the payload to (looked up from
// entry[].changes[].value.metadata.phone_number_id). Pass 0 to store
// with NULL admin_user_id (legacy / unowned).
func (s *Store) InsertWebhookLog(ctx context.Context, adminUserID int64, ip, ua, kind string, payload []byte, msgCount, statusCount int, parseErr *string) (int64, error) {
	var id int64
	var adminArg any
	if adminUserID > 0 {
		adminArg = adminUserID
	}
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_webhook_logs
			(admin_user_id, source_ip, user_agent, event_kind, payload, parsed_messages, parsed_statuses, parse_error)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id
	`, adminArg, ip, ua, kind, payload, msgCount, statusCount, parseErr).Scan(&id)
	return id, err
}

// ListWebhookLogs returns the most recent entries for the admin, newest
// first. Entries with NULL admin_user_id are also included so the live
// feed still surfaces pre-migration / unowned payloads.
func (s *Store) ListWebhookLogs(ctx context.Context, adminUserID int64, limit int) ([]models.WebhookLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if adminUserID <= 0 {
		// Defensive: a misconfigured caller should never see every log.
		return []models.WebhookLog{}, nil
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, received_at, source_ip, user_agent, event_kind,
		       payload, parsed_messages, parsed_statuses, parse_error
		FROM bc_webhook_logs
		WHERE admin_user_id = $1
		ORDER BY received_at DESC
		LIMIT $2
	`, adminUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.WebhookLog{}
	for rows.Next() {
		var l models.WebhookLog
		if err := rows.Scan(&l.ID, &l.AdminUserID, &l.ReceivedAt, &l.SourceIP, &l.UserAgent, &l.EventKind,
			&l.Payload, &l.ParsedMessages, &l.ParsedStatuses, &l.ParseError); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

// ============================================================================
// Pre-enable duplicate detection (Phase 7.5)
//
// These four helpers support the Enable-AI warning modal: before
// creating a new sequence per recipient, the admin can see which
// phones in the new batch already have an active AI follow-up on
// another (or the same) batch, and choose to exclude specific phones
// from the fan-out. 'excluded' is a per-recipient, per-batch state
// (see migration 017) — it is sticky across the per-batch toggle
// on/off cycle and only cleared by the admin un-checking the box on
// the next sequence-start.
// ============================================================================

// BatchAIFollowupDuplicate is one row returned by
// FindActiveFollowupDuplicatesForBatch: a phone in this batch that
// is already enrolled in an active AI follow-up on some other (or
// the same) batch. Surfaced to the warning modal so the admin can
// decide per-phone whether to reuse the existing enrollment (default)
// or exclude this phone from the new sequence entirely.
type BatchAIFollowupDuplicate struct {
	RecipientID  int64     `json:"recipient_id"`
	Phone        string    `json:"phone"`
	RetailerName *string   `json:"retailer_name,omitempty"`
	LeadID       int64     `json:"lead_id"`
	EnrollmentID int64     `json:"enrollment_id"`
	SequenceID   int64     `json:"sequence_id"`
	SequenceName string    `json:"sequence_name"`
	Mode         string    `json:"mode"`
	CurrentStep  int       `json:"current_step"`
	NextRunAt    time.Time `json:"next_run_at"`

	// Phase 9 — multi-agent visibility. Surface which agent is
	// currently handling the existing follow-up so the conflict
	// modal can show "Sales Hindi (batch override)" instead of
	// just a sequence name. Resolved via the source batch row
	// (r.batch_id) — the batch where the recipient was enrolled.
	SourceBatchID      *int64  `json:"source_batch_id,omitempty"`
	SourceBatchName    string  `json:"source_batch_name"` // bc_upload_batches.file_name
	SourceAgentID      *int64  `json:"source_agent_id"`   // nil when batch uses global default
	SourceAgentName    string  `json:"source_agent_name"` // '' when no agent configured
	SourceAgentDefault bool    `json:"source_agent_is_default"`
	SourceAgentSource  string  `json:"source_agent_source"` // "batch_override" | "global_default"
	TargetAgentID      *int64  `json:"target_agent_id"`
	TargetAgentName    string  `json:"target_agent_name"`
	TargetAgentDefault bool    `json:"target_agent_is_default"`
	TargetAgentSource  string  `json:"target_agent_source"`
	AgentConflict      bool    `json:"agent_conflict"`
	StepMessagePreview *string `json:"step_message_preview,omitempty"` // NULL when no step row yet
}

// FindActiveFollowupDuplicatesForBatch returns every phone in this
// batch's bc_batch_ai_recipients that already has an active
// ai_followup / agentic_followup enrollment on another (or the
// same) batch. Admin-scoped.
//
// The query is index-friendly: the new partial index
// ix_bc_crm_seq_enroll_active_ai (migration 017) covers the
// enrollments side; the existing ix_bcai_admin_phone covers the
// recipients side. The two new LEFT JOINs to bc_upload_batches
// (PK) and bc_ai_agents (PK filtered by admin_user_id) are
// O(1) lookups per row.
//
// Phase 9: surfaces the source batch's agent + filename so the
// preflight modal can show "Sales Hindi on batch #12" without
// a second round-trip.
func (s *Store) FindActiveFollowupDuplicatesForBatch(
	ctx context.Context, adminID, batchID int64,
) ([]BatchAIFollowupDuplicate, error) {
	rows, err := s.DB.Query(ctx, `
		WITH current_batch AS (
			SELECT id, file_name, ai_agent_id
			  FROM bc_upload_batches
			 WHERE id = $1
			   AND (uploaded_by = $2 OR uploaded_by IS NULL)
			 LIMIT 1
		),
		current_phones AS (
			SELECT COALESCE(r.id, 0) AS recipient_id,
			       br.whatsapp_number AS phone,
			       ret.retailer_name
			  FROM bc_billing_records br
			  JOIN current_batch cb ON cb.id = br.batch_id
			  LEFT JOIN bc_batch_ai_recipients r
			    ON r.batch_id = br.batch_id
			   AND r.admin_user_id = $2
			   AND r.whatsapp_number = br.whatsapp_number
			  LEFT JOIN bc_retailers ret ON ret.id = br.retailer_id
			 WHERE br.batch_id = $1
			   AND br.is_valid = TRUE
			   AND br.whatsapp_number IS NOT NULL
			   AND trim(br.whatsapp_number) <> ''
		),
		default_agent AS (
			SELECT id, name, is_default
			  FROM bc_ai_agents
			 WHERE admin_user_id = $2
			   AND is_default = TRUE
			 LIMIT 1
		),
		conflicts AS (
			SELECT DISTINCT ON (cp.phone)
			       cp.recipient_id,
			       cp.phone,
			       cp.retailer_name,
			       COALESCE(l.id, 0) AS lead_id,
			       COALESCE(e.id, 0) AS enrollment_id,
			       COALESCE(e.sequence_id, 0) AS sequence_id,
			       COALESCE(seq.name, 'Batch AI follow-up') AS sequence_name,
			       COALESCE(e.mode, 'batch_ai_enabled') AS mode,
			       COALESCE(e.current_step, 0) AS current_step,
			       COALESCE(e.next_run_at, inferred.last_event_at, now()) AS next_run_at,
			       COALESCE(e.created_at, inferred.last_event_at, now()) AS conflict_at,
			       COALESCE(e.source_batch_id, inferred.batch_id) AS source_batch_id,
			       COALESCE(srcb.file_name, '') AS source_batch_name,
			       srca.id AS source_agent_id,
			       COALESCE(srca.name, '') AS source_agent_name,
			       COALESCE(srca.is_default, FALSE) AS source_agent_is_default,
			       CASE
			         WHEN srcb.ai_agent_id IS NOT NULL THEN 'batch_override'
			         WHEN srca.id IS NOT NULL THEN 'global_default'
			         ELSE 'none'
			       END AS source_agent_source,
			       targeta.id AS target_agent_id,
			       COALESCE(targeta.name, '') AS target_agent_name,
			       COALESCE(targeta.is_default, FALSE) AS target_agent_is_default,
			       CASE
			         WHEN cb.ai_agent_id IS NOT NULL THEN 'batch_override'
			         WHEN targeta.id IS NOT NULL THEN 'global_default'
			         ELSE 'none'
			       END AS target_agent_source,
			       COALESCE(srca.id, 0) <> COALESCE(targeta.id, 0) AS agent_conflict,
			       cur.message_template AS step_message_preview
			  FROM current_phones cp
			  JOIN current_batch cb ON TRUE
			  LEFT JOIN bc_crm_leads l
			    ON l.admin_user_id = $2
			   AND l.phone = cp.phone
			  LEFT JOIN LATERAL (
			      SELECT e.*
			        FROM bc_crm_sequence_enrollments e
			       WHERE e.admin_user_id = $2
			         AND e.lead_id = l.id
			         AND e.status = 'active'
			         AND e.mode IN ('ai_followup', 'agentic_followup')
			         AND (e.source_batch_id IS NULL OR e.source_batch_id <> $1)
			       ORDER BY e.created_at DESC, e.id DESC
			       LIMIT 1
			  ) e ON TRUE
			  LEFT JOIN bc_crm_sequences seq ON seq.id = e.sequence_id
			  LEFT JOIN LATERAL (
			      SELECT r.id, r.batch_id, r.last_event_at
			        FROM bc_batch_ai_recipients r
			        JOIN bc_upload_batches b2
			          ON b2.id = r.batch_id
			         AND (b2.uploaded_by = $2 OR b2.uploaded_by IS NULL)
			         AND b2.ai_followup_enabled = TRUE
			       WHERE r.admin_user_id = $2
			         AND r.whatsapp_number = cp.phone
			         AND r.batch_id <> $1
			         AND COALESCE(r.ai_status, 'pending') NOT IN ('excluded', 'opted_out', 'disabled')
			       ORDER BY r.last_event_at DESC NULLS LAST, r.id DESC
			       LIMIT 1
			  ) inferred ON TRUE
			  LEFT JOIN bc_upload_batches srcb
			    ON srcb.id = COALESCE(e.source_batch_id, inferred.batch_id)
			   AND (srcb.uploaded_by = $2 OR srcb.uploaded_by IS NULL)
			  LEFT JOIN default_agent da ON TRUE
			  LEFT JOIN bc_ai_agents srca
			    ON srca.id = COALESCE(srcb.ai_agent_id, da.id)
			   AND srca.admin_user_id = $2
			  LEFT JOIN bc_ai_agents targeta
			    ON targeta.id = COALESCE(cb.ai_agent_id, da.id)
			   AND targeta.admin_user_id = $2
			  LEFT JOIN bc_crm_sequence_steps cur
			    ON cur.sequence_id = e.sequence_id AND cur.position = e.current_step + 1
			 WHERE e.id IS NOT NULL
			    OR inferred.batch_id IS NOT NULL
			 ORDER BY cp.phone, conflict_at DESC, enrollment_id DESC
		)
		SELECT recipient_id, phone, retailer_name, lead_id,
		       enrollment_id, sequence_id, sequence_name, mode,
		       current_step, next_run_at, source_batch_id,
		       source_batch_name,
		       source_agent_id, source_agent_name, source_agent_is_default, source_agent_source,
		       target_agent_id, target_agent_name, target_agent_is_default, target_agent_source,
		       agent_conflict, step_message_preview
		  FROM conflicts
		 ORDER BY agent_conflict DESC, phone
	`, batchID, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BatchAIFollowupDuplicate{}
	for rows.Next() {
		var d BatchAIFollowupDuplicate
		var retailerName *string
		var sourceBatchID *int64
		var agentID *int64
		var targetAgentID *int64
		var stepPreview *string
		if err := rows.Scan(&d.RecipientID, &d.Phone, &retailerName, &d.LeadID,
			&d.EnrollmentID, &d.SequenceID, &d.SequenceName, &d.Mode,
			&d.CurrentStep, &d.NextRunAt, &sourceBatchID,
			&d.SourceBatchName,
			&agentID, &d.SourceAgentName, &d.SourceAgentDefault, &d.SourceAgentSource,
			&targetAgentID, &d.TargetAgentName, &d.TargetAgentDefault, &d.TargetAgentSource,
			&d.AgentConflict,
			&stepPreview); err != nil {
			return nil, err
		}
		d.RetailerName = retailerName
		d.SourceBatchID = sourceBatchID
		d.SourceAgentID = agentID
		d.TargetAgentID = targetAgentID
		d.StepMessagePreview = stepPreview
		out = append(out, d)
	}
	return out, rows.Err()
}

// CountEligibleBatchAIPhones counts valid WhatsApp phones in a batch before
// the AI recipient rows necessarily exist. Existing excluded/opted-out rows
// are omitted so the preflight modal can show how many fresh enrollments will
// be attempted.
func (s *Store) CountEligibleBatchAIPhones(ctx context.Context, adminID, batchID int64) (int, error) {
	var n int
	err := s.DB.QueryRow(ctx, `
		SELECT COUNT(DISTINCT br.whatsapp_number)::int
		  FROM bc_billing_records br
		  JOIN bc_upload_batches b
		    ON b.id = br.batch_id
		   AND (b.uploaded_by = $2 OR b.uploaded_by IS NULL)
		  LEFT JOIN bc_batch_ai_recipients r
		    ON r.batch_id = br.batch_id
		   AND r.admin_user_id = $2
		   AND r.whatsapp_number = br.whatsapp_number
		 WHERE br.batch_id = $1
		   AND br.is_valid = TRUE
		   AND br.whatsapp_number IS NOT NULL
		   AND trim(br.whatsapp_number) <> ''
		   AND COALESCE(r.ai_status, 'pending') NOT IN ('excluded', 'opted_out')
	`, batchID, adminID).Scan(&n)
	return n, err
}

// ExcludeRecipientsFromBatch flags the given phones in this batch's
// bc_batch_ai_recipients rows as 'excluded' so the sequence-start
// fan-out skips them. Idempotent. Returns the list of recipient IDs
// actually updated (for audit / UI feedback).
//
// We deliberately do NOT touch rows in 'active', 'handed_off',
// 'opted_out', or 'failed' — those rows carry real agent history
// and the admin's intent is "don't enroll me in a new sequence",
// not "rewrite my history". Only 'pending', 'disabled', and
// 'excluded' rows are flipped (so re-running the modal is a
// no-op for already-excluded rows).
func (s *Store) ExcludeRecipientsFromBatch(
	ctx context.Context, adminID, batchID int64, phones []string,
) ([]int64, error) {
	if len(phones) == 0 {
		return nil, nil
	}
	rows, err := s.DB.Query(ctx, `
		UPDATE bc_batch_ai_recipients
		   SET ai_status = 'excluded',
		       last_event = 'excluded by admin',
		       last_event_at = now()
		 WHERE batch_id = $1
		   AND admin_user_id = $2
		   AND whatsapp_number = ANY($3)
		   AND ai_status IN ('pending','disabled','excluded')
		RETURNING id, whatsapp_number
	`, batchID, adminID, phones)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		var phone string
		if err := rows.Scan(&id, &phone); err != nil {
			return ids, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ResetExcludedRecipients clears 'excluded' back to 'pending' for the
// given phones, so the next sequence-start re-enrolls them. Only
// targets rows currently in 'excluded'.
func (s *Store) ResetExcludedRecipients(
	ctx context.Context, adminID, batchID int64, phones []string,
) error {
	if len(phones) == 0 {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_batch_ai_recipients
		   SET ai_status = 'pending',
		       last_event = 're-included by admin',
		       last_event_at = now()
		 WHERE batch_id = $1
		   AND admin_user_id = $2
		   AND whatsapp_number = ANY($3)
		   AND ai_status = 'excluded'
	`, batchID, adminID, phones)
	return err
}

// ListExcludedPhonesForBatch returns the phones in this batch whose
// bc_batch_ai_recipients row is currently 'excluded'. Used to diff
// against the next call's exclude_phones list and un-exclude phones
// the admin un-checked in the warning modal.
func (s *Store) ListExcludedPhonesForBatch(
	ctx context.Context, adminID, batchID int64,
) ([]string, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT whatsapp_number
		  FROM bc_batch_ai_recipients
		 WHERE batch_id = $1
		   AND admin_user_id = $2
		   AND ai_status = 'excluded'
		 ORDER BY whatsapp_number
	`, batchID, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return out, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
