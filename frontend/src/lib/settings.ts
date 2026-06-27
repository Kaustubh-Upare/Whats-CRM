import { api } from '@/lib/api'
import type { AdminUser, CredentialsHistoryEntry, GoogleStatus, WhatsappSettings } from '@/lib/types'

export interface PutMyProfilePayload {
  name?: string
  workspace_name: string
}

export async function putMyProfile(payload: PutMyProfilePayload): Promise<AdminUser> {
  const { data } = await api.put('/auth/me', payload)
  return data as AdminUser
}

export interface PutWhatsappSettingsPayload {
  phone_number_id: string
  access_token: string
  verify_token: string
  waba_id?: string
  api_version?: string
}

export interface TestWhatsappResult {
  ok: boolean
  phone_number_id?: string
  display_phone_number?: string
  verified_name?: string
  quality_rating?: string
}

export async function getWhatsappSettings(): Promise<WhatsappSettings> {
  const { data } = await api.get('/api/settings/whatsapp')
  return data as WhatsappSettings
}

export async function putWhatsappSettings(
  payload: PutWhatsappSettingsPayload,
): Promise<WhatsappSettings> {
  const { data } = await api.put('/api/settings/whatsapp', payload)
  return data as WhatsappSettings
}

export async function testWhatsappSettings(): Promise<TestWhatsappResult> {
  const { data } = await api.post('/api/settings/whatsapp/test')
  return data as TestWhatsappResult
}

// Soft-delete: the backend sets removed_at, snapshots the public
// identifiers into last_known_*, and keeps the encrypted tokens on disk.
export async function deleteWhatsappSettings(): Promise<void> {
  await api.delete('/api/settings/whatsapp')
}

// Restore: clears removed_at so the previously-stored encrypted tokens
// become "active" again. No need to retype them.
export async function restoreWhatsappSettings(): Promise<WhatsappSettings> {
  const { data } = await api.post('/api/settings/whatsapp/restore')
  return data as WhatsappSettings
}

// Lifecycle history (created/updated/removed/restored) for the
// "Activity" section in the Settings card.
export async function getCredentialsHistory(limit = 25): Promise<CredentialsHistoryEntry[]> {
  const { data } = await api.get('/api/settings/whatsapp/history', { params: { limit } })
  return (data?.items || []) as CredentialsHistoryEntry[]
}

// Google OAuth status — the /login page reads this so the
// "Continue with Google" button can render a disabled state when
// the server hasn't been configured with BC_GOOGLE_CLIENT_ID.
export async function getGoogleStatus(): Promise<GoogleStatus> {
  const { data } = await api.get('/auth/google')
  return data as GoogleStatus
}