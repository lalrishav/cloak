import { useNavigate } from 'react-router-dom'
import { useUsage, useSessions, useActiveSessions } from '../api/hooks.js'
import StatCard from '../components/StatCard.jsx'
import BarChart from '../components/BarChart.jsx'
import TimeSeriesChart from '../components/TimeSeriesChart.jsx'
import DataTable from '../components/DataTable.jsx'
import { toBarData, shortId, fmtDate } from '../util.js'

export default function UsageActivity() {
  const usage = useUsage()
  const sessions = useSessions()
  const active = useActiveSessions()
  const navigate = useNavigate()

  const sessionCols = [
    { key: 'sessionId', label: 'Session', mono: true, render: (r) => shortId(r.sessionId) },
    { key: 'installId', label: 'Install', mono: true, render: (r) => shortId(r.installId) },
    { key: 'version', label: 'Version' },
    { key: 'eventCount', label: 'Events' },
    { key: 'lastAt', label: 'Last event', render: (r) => fmtDate(r.lastAt) }
  ]

  return (
    <>
      <div className="page-head">
        <h1>Usage Activity</h1>
        <span className="sub">
          {active.data ? `${active.data.items.length} active now` : ''}
        </span>
      </div>
      {usage.isError && (
        <div className="error-banner">Could not load usage stats.</div>
      )}
      {usage.data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <StatCard label="Total events" value={usage.data.totalEvents} />
            <StatCard label="Distinct sessions" value={usage.data.distinctSessions} />
            <StatCard
              label="Active now"
              value={active.data ? active.data.items.length : '—'}
              hint="last 5 min"
            />
          </div>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <h2>Events by type</h2>
              <BarChart data={toBarData(usage.data.byType, 16)} />
            </div>
            <div className="card">
              <h2>Events — last 30 days</h2>
              <TimeSeriesChart data={usage.data.eventsByDay} />
            </div>
          </div>
        </>
      )}
      <div className="card">
        <h2>Sessions</h2>
        {sessions.isLoading && <div className="loading">Loading…</div>}
        {sessions.data && (
          <DataTable
            columns={sessionCols}
            rows={sessions.data.items}
            empty="No sessions yet — run a teleprompter session with analytics enabled."
            onRowClick={(r) =>
              navigate(`/sessions/${encodeURIComponent(r.sessionId)}`)
            }
          />
        )}
      </div>
    </>
  )
}
