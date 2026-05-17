export default function StatCard({ label, value, hint }) {
  return (
    <div className="card stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint != null && <div className="hint">{hint}</div>}
    </div>
  )
}
