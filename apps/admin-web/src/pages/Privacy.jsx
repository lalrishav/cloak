import { useState } from 'react'
import { exportInstall, useDeleteInstall } from '../api/hooks.js'

export default function Privacy() {
  const [installId, setInstallId] = useState('')
  const [msg, setMsg] = useState('')
  const del = useDeleteInstall()
  const id = installId.trim()

  const doExport = async () => {
    setMsg('')
    try {
      const data = await exportInstall(id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cue-install-${id}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg('Export downloaded.')
    } catch {
      setMsg('Export failed — check the install id.')
    }
  }

  const doDelete = () => {
    if (
      !window.confirm(
        `Delete ALL cloud data for install ${id}? This erases its install record, boots, and events. Cannot be undone.`
      )
    ) {
      return
    }
    del.mutate(id, {
      onSuccess: (r) =>
        setMsg(
          `Deleted: ${r.deleted.installs} install record, ${r.deleted.appBoots} boots, ${r.deleted.events} events.`
        ),
      onError: () => setMsg('Delete failed.')
    })
  }

  return (
    <>
      <div className="page-head">
        <h1>Privacy &amp; Data</h1>
        <span className="sub">export or erase a single install&apos;s data</span>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <h2>Install data</h2>
        <div className="field">
          <label>Install ID</label>
          <input
            value={installId}
            onChange={(e) => setInstallId(e.target.value)}
            placeholder="uuid from the desktop app's diagnostics panel"
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doExport} disabled={!id}>
            Export JSON
          </button>
          <button className="danger" onClick={doDelete} disabled={!id || del.isPending}>
            {del.isPending ? 'Deleting…' : 'Delete all data'}
          </button>
        </div>
        {msg && (
          <p className="muted" style={{ marginTop: 14 }}>
            {msg}
          </p>
        )}
      </div>
      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h2>Retention</h2>
        <p className="muted" style={{ margin: 0 }}>
          Telemetry is anonymous (install id only — no script content, transcripts, or personal
          info). A scheduled retention job to age out old <span className="mono">events</span> is a
          planned follow-up; for now data is kept indefinitely in the local{' '}
          <span className="mono">cue_cloud</span> database.
        </p>
      </div>
    </>
  )
}
