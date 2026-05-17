import { useVersionHealth } from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'

export default function VersionHealth() {
  const { data, isLoading, isError } = useVersionHealth()

  const columns = [
    { key: 'version', label: 'Version', mono: true },
    { key: 'count', label: 'Installs' },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.blocked ? (
          <span className="badge bad">blocked</span>
        ) : r.deprecated ? (
          <span className="badge warn">deprecated</span>
        ) : r.outdated ? (
          <span className="badge warn">outdated</span>
        ) : (
          <span className="badge good">current</span>
        )
    }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Version Health</h1>
        <span className="sub">adoption &amp; policy status</span>
      </div>
      {isError && <div className="error-banner">Could not load version health.</div>}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <StatCard label="Latest version" value={data.latestVersion || '—'} />
            <StatCard label="Minimum version" value={data.minVersion || '—'} />
            <StatCard label="Total installs" value={data.totalInstalls} />
          </div>
          <div className="card">
            <h2>Installs by version</h2>
            <DataTable
              columns={columns}
              rows={data.versions}
              empty="No installs yet."
            />
          </div>
        </>
      )}
    </>
  )
}
