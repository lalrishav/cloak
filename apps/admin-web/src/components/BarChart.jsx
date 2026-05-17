import {
  BarChart as RBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

export default function BarChart({ data, color = '#6ea8fe', height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data || []} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#2a2a32" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: '#8a8a95', fontSize: 11 }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={56}
        />
        <YAxis tick={{ fill: '#8a8a95', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{
            background: '#16161a',
            border: '1px solid #2a2a32',
            borderRadius: 8
          }}
        />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
      </RBarChart>
    </ResponsiveContainer>
  )
}
