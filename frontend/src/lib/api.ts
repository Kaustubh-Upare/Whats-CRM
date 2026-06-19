import axios from 'axios'

export const api = axios.create({
  baseURL: '/', // proxied by Vite to http://localhost:8082
  withCredentials: true, // send the bc_token cookie
  headers: { 'Content-Type': 'application/json' },
})

// Token helper (Authorization header takes priority over cookie)
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
