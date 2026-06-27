import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getToken } from '@/lib/api'
import type { AdminUser } from '@/lib/types'

// Minimal shape returned by /auth/me — kept inline so the auth gate
// can run before the rest of the app imports every domain type.
export type MeResponse = AdminUser & {
  whatsapp_configured?: boolean
  oauth_provider?: string | null
  avatar_url?: string | null
}

/**
 * useAuth is the single source of truth for "is this user signed in?".
 *
 * It checks three signals in order:
 *   1. localStorage token — fast path for the password-login flow,
 *      where the JWT arrives in the response body.
 *   2. /auth/me round-trip — covers the Google OAuth flow, where the
 *      JWT lives only in an httpOnly cookie (intentionally unreadable
 *      from JS). The axios client uses withCredentials, so the cookie
 *      travels automatically.
 *   3. Failed /auth/me → unauthenticated.
 *
 * The whole app reads `status` instead of calling getToken() directly.
 * That fixes the redirect loop where:
 *   - Login page redirected to /admin because localStorage was empty
 *     but the cookie was valid
 *   - Protected route then bounced back to /login because it only
 *     read localStorage
 *   - Login probed /auth/me, saw the cookie was valid, redirected again
 *
 * Returns: 'loading' | 'authed' | 'guest'
 */
export type AuthStatus = 'loading' | 'authed' | 'guest'

export function useAuth(): { status: AuthStatus; user: MeResponse | null } {
  const hasLocalToken = !!getToken()

  const me = useQuery({
    // Key includes the localStorage-token flag so that clearing the
    // token (logout) invalidates this query and forces a re-probe.
    queryKey: ['auth', 'me', hasLocalToken ? 'local' : 'cookie-only'],
    queryFn: async () => (await api.get<MeResponse>('/auth/me')).data,
    // Probe /auth/me even when localStorage is empty: this is the
    // path that detects a cookie-only session (e.g. after Google OAuth).
    enabled: true,
    retry: false,
    staleTime: 30_000,
  })

  if (me.isLoading) return { status: 'loading', user: null }
  if (me.isError || !me.data) return { status: 'guest', user: null }
  return { status: 'authed', user: me.data }
}