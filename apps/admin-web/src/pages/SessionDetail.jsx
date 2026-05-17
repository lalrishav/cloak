import { useParams, Link } from 'react-router-dom'
import { useSession } from '../api/hooks.js'
import SessionTimeline from '../components/SessionTimeline.jsx'
import { shortId } from '../util.js'

export default function SessionDetail() {
  const { id } = useParams()
  const { data, isLoading, isError } = useSession(id)

  return (
    <>
      <div className="page-head">
        <h1>Session {shortId(id)}</h1>
        <Link to="/usage" className="sub">
          ← back to Usage
        </Link>
      </div>
      {isError && <div className="error-banner">Session not found.</div>}
      {isLoading && <div className="loading">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="card stat-card">
              <div className="label">Install</div>
              <div className="value mono" style={{ fontSize: 16 }}>
                {shortId(data.installId)}
              </div>
            </div>
            <div className="card stat-card">
              <div className="label">App version</div>
              <div className="value" style={{ fontSize: 20 }}>
                {data.version || '—'}
              </div>
            </div>
            <div className="card stat-card">
              <div className="label">Events</div>
              <div className="value">{data.eventCount}</div>
            </div>
          </div>
          <div className="card">
            <h2>Event timeline</h2>
            <SessionTimeline events={data.events} />
          </div>
        </>
      )}
    </>
  )
}
