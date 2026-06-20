/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the backend API (no trailing slash). */
  readonly VITE_API_BASE?: string
  /** Display name for the app (used in <title> / OG tags). */
  readonly VITE_APP_NAME?: string
  /** App version surfaced to the UI / analytics. */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}