import axios from 'axios'

// In production, VITE_API_BASE points at the public backend URL
// (e.g. https://api.your-domain.com). In dev it's left empty so the request
// goes to "/" and Vite's dev proxy (vite.config.ts) forwards it to the
// local Go server on :8082.
const baseURL = import.meta.env.VITE_API_BASE || '/'

export const api = axios.create({
  baseURL,
  withCredentials: true, // send the bc_token cookie
  headers: { 'Content-Type': 'application/json' },
})

// Token helper (Authorization header takes priority over cookie).
// In production behind HTTPS the cookie is Secure+HttpOnly and localStorage
// is left unused; we still keep the Bearer path so SSR / curl clients work.
let _token: string | null = null
export function setToken(t: string | null) {
  _token = t
  if (t) localStorage.setItem('bc_token', t)
  else localStorage.removeItem('bc_token')
}
export function getToken(): string | null {
  if (_token) return _token
  _token = localStorage.getItem('bc_token')
  return _token
}

api.interceptors.request.use((cfg) => {
  const t = getToken()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && !location.pathname.startsWith('/login')) {
      setToken(null)
      location.href = '/login'
    }
    return Promise.reject(err)
  },
)