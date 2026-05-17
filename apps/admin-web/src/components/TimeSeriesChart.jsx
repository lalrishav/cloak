import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

export default function TimeSeriesChart({ data, color = '#6ea8fe', height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data || []} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#2a2a32" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#8a8a95', fontSize: 11 }}
          tickFormatter={(d) => (d ? String(d).slice(5) : '')}
        />
        <YAxis tick={{ fill: '#8a8a95', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: '#16161a',
            border: '1px solid #2a2a32',
            borderRadius: 8
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={color}
          fill={color}
          fillOpacity={0.15}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
