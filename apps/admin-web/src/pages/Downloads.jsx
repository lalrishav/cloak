import { useDownloads } from '../api/hooks.js'
import DataTable from '../components/DataTable.jsx'
import BarChart from '../components/BarChart.jsx'
import StatCard from '../components/StatCard.jsx'
import { fmtDate, toBarData } from '../util.js'

export default function Downloads() {
  const { data, isLoading, isError } = useDownloads()
  const items = (data && data.items) || []

  const byOs = {}
  const byVersion = {}
  for (const d of items) {
    byOs[d.os || 'unknown'] = (byOs[d.os || 'unknown'] || 0) + 1
    if (d.version) byVersion[d.version] = (byVersion[d.version] || 0) + 1
  }

  const columns = [
    { key: 'ts', label: 'When', render: (r) => fmtDate(r.ts) },
    { key: 'os', label: 'OS' },
    { key: 'version', label: 'Version', render: (r) => r.version || '—' },
    { key: 'channel', label: 'Channel' },
    { key: 'referrer', label: 'Referrer', render: (r) => r.referrer || '—' }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Downloads</h1>
        <span className="sub">{items.length} recorded</span>
      </div>
      {isError && <div className="error-banner">Could not load downloads.</div>}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <h2>By platform</h2>
              <BarChart data={toBarData(byOs)} color="#5ad17f" />
            </div>
            <div className="card">
              <h2>By version</h2>
              <BarChart data={toBarData(byVersion)} color="#e0b04a" />
            </div>
          </div>
          <div className="card">
            <h2>Recent downloads</h2>
            <DataTable
              columns={columns}
              rows={items}
              empty="No downloads recorded yet — open the /download page and click a button."
            />
          </div>
        </>
      )}
    </>
  )
}
