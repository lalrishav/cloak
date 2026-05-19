import { useState } from 'react'
import {
  useVersionPolicies,
  useReleases,
  useUpsertVersionPolicy,
  useDeleteVersionPolicy,
  useCreateRelease
} from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import { fmtDate } from '../util.js'

const EMPTY_POLICY = {
  version: '*',
  channel: '*',
  platform: '*',
  status: 'allowed',
  minVersion: '1.0.0',
  latestVersion: '1.0.0',
  message: '',
  updateUrl: '',
  featureFlags: '{}'
}

export default function Releases() {
  const policies = useVersionPolicies()
  const releases = useReleases()
  const upsert = useUpsertVersionPolicy()
  const del = useDeleteVersionPolicy()
  const createRelease = useCreateRelease()

  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [release, setRelease] = useState({
    version: '',
    channel: 'stable',
    notes: '',
    assets: '{}'
  })
  const [formErr, setFormErr] = useState('')

  const setP = (k) => (e) => setPolicy({ ...policy, [k]: e.target.value })
  const setR = (k) => (e) => setRelease({ ...release, [k]: e.target.value })

  const submitPolicy = (e) => {
    e.preventDefault()
    setFormErr('')
    let featureFlags
    try {
      featureFlags = JSON.parse(policy.featureFlags || '{}')
    } catch {
      setFormErr('Feature flags must be valid JSON.')
      return
    }
    upsert.mutate(
      { ...policy, featureFlags },
      {
        onSuccess: () => setPolicy(EMPTY_POLICY),
        onError: (err) =>
          setFormErr((err.response && err.response.data && err.response.data.error) || 'Save failed.')
      }
    )
  }

  const submitRelease = (e) => {
    e.preventDefault()
    setFormErr('')
    let assets
    try {
      assets = JSON.parse(release.assets || '{}')
    } catch {
      setFormErr('Assets must be valid JSON.')
      return
    }
    createRelease.mutate(
      { version: release.version, channel: release.channel, notes: release.notes, assets },
      {
        onSuccess: () => setRelease({ version: '', channel: 'stable', notes: '', assets: '{}' }),
        onError: (err) =>
          setFormErr((err.response && err.response.data && err.response.data.error) || 'Publish failed.')
      }
    )
  }

  const editPolicy = (row) =>
    setPolicy({
      version: row.version,
      channel: row.channel,
      platform: row.platform,
      status: row.status,
      minVersion: row.minVersion,
      latestVersion: row.latestVersion,
      message: row.message || '',
      updateUrl: row.updateUrl || '',
      featureFlags: JSON.stringify(row.featureFlags || {})
    })

  const policyCols = [
    { key: 'version', label: 'Version', mono: true },
    { key: 'channel', label: 'Channel' },
    { key: 'platform', label: 'Platform' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <span
          className={`badge ${
            r.status === 'blocked' ? 'bad' : r.status === 'deprecated' ? 'warn' : 'good'
          }`}
        >
          {r.status}
        </span>
      )
    },
    { key: 'minVersion', label: 'Min' },
    { key: 'latestVersion', label: 'Latest' },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => editPolicy(r)}>Edit</button>
          <button className="danger" onClick={() => del.mutate(r.id)}>
            Delete
          </button>
        </span>
      )
    }
  ]

  const releaseCols = [
    { key: 'version', label: 'Version', mono: true },
    { key: 'channel', label: 'Channel' },
    { key: 'createdAt', label: 'Published', render: (r) => fmtDate(r.createdAt) },
    { key: 'publishedBy', label: 'By' },
    { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Releases &amp; Version Policy</h1>
        <span className="sub">control which versions are allowed</span>
      </div>
      {formErr && <div className="error-banner">{formErr}</div>}

      <div className="grid grid-2">
        <form className="card" onSubmit={submitPolicy}>
          <h2>Set version policy</h2>
          <div className="field-row">
            <div className="field">
              <label>Version (or *)</label>
              <input value={policy.version} onChange={setP('version')} />
            </div>
            <div className="field">
              <label>Channel</label>
              <select value={policy.channel} onChange={setP('channel')}>
                <option value="*">*</option>
                <option value="dev">dev</option>
                <option value="stable">stable</option>
              </select>
            </div>
            <div className="field">
              <label>Platform</label>
              <select value={policy.platform} onChange={setP('platform')}>
                <option value="*">*</option>
                <option value="darwin">darwin</option>
                <option value="win32">win32</option>
                <option value="linux">linux</option>
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Status</label>
              <select value={policy.status} onChange={setP('status')}>
                <option value="allowed">allowed</option>
                <option value="deprecated">deprecated</option>
                <option value="blocked">blocked</option>
              </select>
            </div>
            <div className="field">
              <label>Min version</label>
              <input value={policy.minVersion} onChange={setP('minVersion')} />
            </div>
            <div className="field">
              <label>Latest version</label>
              <input value={policy.latestVersion} onChange={setP('latestVersion')} />
            </div>
          </div>
          <div className="field">
            <label>Message (shown in the gate dialog)</label>
            <input value={policy.message} onChange={setP('message')} />
          </div>
          <div className="field">
            <label>Update URL</label>
            <input value={policy.updateUrl} onChange={setP('updateUrl')} />
          </div>
          <div className="field">
            <label>Feature flags (JSON)</label>
            <textarea rows={2} value={policy.featureFlags} onChange={setP('featureFlags')} />
          </div>
          <button className="primary" type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save policy'}
          </button>
        </form>

        <form className="card" onSubmit={submitRelease}>
          <h2>Publish release</h2>
          <div className="field">
            <label>Version</label>
            <input
              value={release.version}
              onChange={setR('version')}
              placeholder="1.2.0"
              required
            />
          </div>
          <div className="field">
            <label>Channel</label>
            <select value={release.channel} onChange={setR('channel')}>
              <option value="stable">stable</option>
              <option value="dev">dev</option>
            </select>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea rows={2} value={release.notes} onChange={setR('notes')} />
          </div>
          <div className="field">
            <label>{'Assets (JSON: { "darwin": { "url": "…" }, "win32": { "url": "…" } })'}</label>
            <textarea rows={3} value={release.assets} onChange={setR('assets')} />
          </div>
          <button className="primary" type="submit" disabled={createRelease.isPending}>
            {createRelease.isPending ? 'Publishing…' : 'Publish release'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Active version policies</h2>
        {policies.isLoading && <div className="loading">Loading…</div>}
        {policies.data && (
          <DataTable columns={policyCols} rows={policies.data.items} />
        )}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Releases</h2>
        {releases.isLoading && <div className="loading">Loading…</div>}
        {releases.data && (
          <DataTable
            columns={releaseCols}
            rows={releases.data.items}
            empty="No releases published yet."
          />
        )}
      </div>
    </>
  )
}
