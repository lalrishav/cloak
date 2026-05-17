import { useOverview } from '../api/hooks.js'
import StatCard from '../components/StatCard.jsx'
import TimeSeriesChart from '../components/TimeSeriesChart.jsx'
import BarChart from '../components/BarChart.jsx'
import { toBarData } from '../util.js'

export default function Overview() {
  const { data, isLoading, isError } = useOverview()
  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <span className="sub">installs, activity, downloads</span>
      </div>
      {isError && (
        <div className="error-banner">Could not load stats — is the API running on :8787?</div>
      )}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <StatCard label="Total installs" value={data.totalInstalls} />
            <StatCard label="Active (30d)" value={data.activeInstalls} />
            <StatCard label="DAU" value={data.dau} hint={`MAU ${data.mau}`} />
            <StatCard
              label="Downloads"
              value={data.totalDownloads}
              hint={`${data.totalBoots} boots`}
            />
          </div>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <h2>Boots — last 30 days</h2>
              <TimeSeriesChart data={data.bootsByDay} />
            </div>
            <div className="card">
              <h2>Downloads — last 30 days</h2>
              <TimeSeriesChart data={data.downloadsByDay} color="#5ad17f" />
            </div>
          </div>
          <div className="card">
            <h2>Version distribution</h2>
            <BarChart data={toBarData(data.versionDist)} />
          </div>
        </>
      )}
    </>
  )
}
