import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEvents } from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import { shortId, fmtDate } from '../util.js'

export default function EventExplorer() {
  const [searchParams] = useSearchParams()
  const initial = {
    installId: searchParams.get('installId') || '',
    type: '',
    sessionId: ''
  }
  const [filters, setFilters] = useState(initial)
  const [applied, setApplied] = useState(initial)
  const { data, isLoading } = useEvents({ ...applied, limit: 300 })

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const apply = (e) => {
    e.preventDefault()
    setApplied(filters)
  }

  const columns = [
    { key: 'receivedAt', label: 'When', render: (r) => fmtDate(r.receivedAt) },
    { key: 'type', label: 'Type', mono: true },
    { key: 'installId', label: 'Install', mono: true, render: (r) => shortId(r.installId) },
    { key: 'sessionId', label: 'Session', mono: true, render: (r) => shortId(r.sessionId) },
    { key: 'tMs', label: 't (ms)' },
    {
      key: 'payload',
      label: 'Payload',
      mono: true,
      render: (r) =>
        r.payload && Object.keys(r.payload).length ? JSON.stringify(r.payload) : '—'
    }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Event Explorer</h1>
        <span className="sub">{data ? `${data.items.length} events` : ''}</span>
      </div>
      <form className="toolbar" onSubmit={apply}>
        <input
          placeholder="install id"
          value={filters.installId}
          onChange={set('installId')}
        />
        <input placeholder="type" value={filters.type} onChange={set('type')} />
        <input
          placeholder="session id"
          value={filters.sessionId}
          onChange={set('sessionId')}
        />
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <div className="card">
          <DataTable columns={columns} rows={data.items} empty="No events match." />
        </div>
      )}
    </>
  )
}
