// Renders a cloud session's events on the tMs axis — a direct port of the
// desktop app's session-event timeline concept.
const LIFECYCLE = new Set([
  'session_started',
  'session_ended',
  'app_boot',
  'version_allowed',
  'version_blocked'
])

function fmt(tMs) {
  const s = Math.max(0, Math.floor((tMs || 0) / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function SessionTimeline({ events }) {
  if (!events || events.length === 0) {
    return <div className="empty">No events in this session.</div>
  }
  return (
    <div className="timeline">
      {events.map((e, i) => {
        const kind = e.type === 'error' ? 'error' : LIFECYCLE.has(e.type) ? 'lifecycle' : ''
        const hasPayload = e.payload && Object.keys(e.payload).length > 0
        return (
          <div className="timeline-row" key={e.id || i}>
            <div className="t">{fmt(e.tMs)}</div>
            <div className="ev">
              <span className={`dot ${kind}`} />
              <span>{e.type}</span>
              {hasPayload && (
                <span className="dim mono" style={{ fontSize: 11 }}>
                  {JSON.stringify(e.payload)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
