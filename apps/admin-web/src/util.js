export function shortId(id) {
  if (!id) return '—'
  return String(id).length > 12 ? String(id).slice(0, 8) + '…' : String(id)
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

export function fmtDateShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString()
}

// turn an object map { key: count } into a sorted [{ name, count }] array
export function toBarData(map, limit = 12) {
  return Object.entries(map || {})
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
