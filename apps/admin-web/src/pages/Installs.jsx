import { useNavigate } from 'react-router-dom'
import { useInstalls } from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import { shortId, fmtDate } from '../util.js'

export default function Installs() {
  const { data, isLoading, isError } = useInstalls({ limit: 200 })
  const navigate = useNavigate()

  const columns = [
    { key: 'installId', label: 'Install', mono: true, render: (r) => shortId(r.installId) },
    { key: 'os', label: 'OS' },
    { key: 'arch', label: 'Arch' },
    { key: 'lastVersion', label: 'Version' },
    { key: 'bootCount', label: 'Boots' },
    { key: 'firstSeenAt', label: 'First seen', render: (r) => fmtDate(r.firstSeenAt) },
    { key: 'lastSeenAt', label: 'Last seen', render: (r) => fmtDate(r.lastSeenAt) }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Installs</h1>
        <span className="sub">{data ? `${data.total} total` : ''}</span>
      </div>
      {isError && <div className="error-banner">Could not load installs.</div>}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <div className="card">
          <DataTable
            columns={columns}
            rows={data.items}
            empty="No installs yet — launch the desktop app to register one."
            onRowClick={(r) =>
              navigate(`/events?installId=${encodeURIComponent(r.installId)}`)
            }
          />
        </div>
      )}
    </>
  )
}
