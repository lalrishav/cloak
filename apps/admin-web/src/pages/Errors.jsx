import { useErrors } from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import { shortId, fmtDate } from '../util.js'

export default function Errors() {
  const { data, isLoading, isError } = useErrors()

  const columns = [
    { key: 'receivedAt', label: 'When', render: (r) => fmtDate(r.receivedAt) },
    { key: 'installId', label: 'Install', mono: true, render: (r) => shortId(r.installId) },
    { key: 'version', label: 'Version', render: (r) => r.version || '—' },
    { key: 'where', label: 'Where', render: (r) => (r.payload && r.payload.where) || '—' },
    { key: 'name', label: 'Error', render: (r) => (r.payload && r.payload.name) || '—' }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Errors</h1>
        <span className="sub">{data ? `${data.items.length} recent` : ''}</span>
      </div>
      {isError && <div className="error-banner">Could not load errors.</div>}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <div className="card">
          <DataTable
            columns={columns}
            rows={data.items}
            empty="No errors reported — that's a good sign."
          />
        </div>
      )}
    </>
  )
}
