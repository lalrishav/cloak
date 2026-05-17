// Generic table. `columns` is [{ key, label, mono?, render? }].
export default function DataTable({ columns, rows, empty = 'No data yet.', onRowClick }) {
  if (!rows || rows.length === 0) {
    return <div className="empty">{empty}</div>
  }
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.id || row.installId || row.sessionId || i}
            className={onRowClick ? 'row-link' : ''}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((c) => (
              <td key={c.key} className={c.mono ? 'mono' : ''}>
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
