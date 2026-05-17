import axios from 'axios'

// Empty baseURL in dev -> Vite proxy forwards /admin and /v1 to :8787.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  withCredentials: true
})

function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

// Attach the CSRF token (double-submit cookie) on every write request.
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    const token = readCookie('cue_csrf')
    if (token) config.headers['x-csrf-token'] = token
  }
  return config
})
