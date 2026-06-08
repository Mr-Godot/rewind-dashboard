import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { DailyActivity } from '@/lib/parsers/types'
import { format } from 'date-fns'

export function ActivityChart({ data }: { data: DailyActivity[] }) {
  const chartData = data.map((d) => ({
    ...d,
    dateLabel: format(new Date(d.date), 'MMM d'),
  }))

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <h3 className="text-sm font-semibold text-gray-300">Daily Activity</h3>
      <p className="mt-1 text-xs text-gray-500">
        Messages, sessions, and tool calls per day
      </p>

      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-800)" />
            <XAxis
              dataKey="dateLabel"
              tick={{ fill: 'var(--color-gray-500)', fontSize: 10 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--color-gray-500)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-gray-900)',
                border: '1px solid var(--color-gray-700)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Bar
              dataKey="messageCount"
              name="Messages"
              fill="#d97757"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="toolCallCount"
              name="Tool Calls"
              fill="#8b5cf6"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="sessionCount"
              name="Sessions"
              fill="#10b981"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
