import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client.js'

const get = (url, params) => api.get(url, { params }).then((r) => r.data)

// ---------- auth ----------
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => get('/admin/me'),
    retry: false
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (creds) => api.post('/admin/login', creds).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] })
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/admin/logout').then((r) => r.data),
    onSuccess: () => qc.clear()
  })
}

// ---------- read endpoints ----------
export const useOverview = () =>
  useQuery({ queryKey: ['overview'], queryFn: () => get('/admin/stats/overview') })

export const useInstalls = (params) =>
  useQuery({ queryKey: ['installs', params], queryFn: () => get('/admin/installs', params) })

export const useInstall = (id) =>
  useQuery({ queryKey: ['install', id], queryFn: () => get(`/admin/installs/${id}`), enabled: !!id })

export const useDownloads = () =>
  useQuery({ queryKey: ['downloads'], queryFn: () => get('/admin/downloads') })

export const useVersionHealth = () =>
  useQuery({ queryKey: ['version-health'], queryFn: () => get('/admin/version-health') })

export const useUsage = () =>
  useQuery({ queryKey: ['usage'], queryFn: () => get('/admin/usage') })

export const useErrors = () =>
  useQuery({ queryKey: ['errors'], queryFn: () => get('/admin/errors') })

export const useEvents = (params) =>
  useQuery({ queryKey: ['events', params], queryFn: () => get('/admin/events', params) })

export const useSessions = () =>
  useQuery({ queryKey: ['sessions'], queryFn: () => get('/admin/sessions') })

export const useSession = (id) =>
  useQuery({ queryKey: ['session', id], queryFn: () => get(`/admin/sessions/${id}`), enabled: !!id })

export const useActiveSessions = () =>
  useQuery({
    queryKey: ['active'],
    queryFn: () => get('/admin/active'),
    refetchInterval: 5000
  })

export const useVersionPolicies = () =>
  useQuery({ queryKey: ['version-policies'], queryFn: () => get('/admin/version-policies') })

export const useReleases = () =>
  useQuery({ queryKey: ['releases'], queryFn: () => get('/admin/releases') })

// ---------- write endpoints ----------
export function useUpsertVersionPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (policy) =>
      api.post('/admin/version-policies', policy).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['version-policies'] })
  })
}

export function useDeleteVersionPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/version-policies/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['version-policies'] })
  })
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (release) => api.post('/admin/releases', release).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases'] })
  })
}

export function useDeleteInstall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/installs/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installs'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    }
  })
}

// install data export — returns the JSON blob for download
export function exportInstall(id) {
  return api.get(`/admin/installs/${id}/export`).then((r) => r.data)
}
