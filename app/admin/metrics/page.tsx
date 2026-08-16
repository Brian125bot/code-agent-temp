import { db } from '@/lib/db/client'
import { metricsDaily } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'

export default async function AdminMetricsPage() {
  if (process.env.NEXT_PUBLIC_ADMIN_ENABLED !== 'true') {
    notFound()
  }

  const rows = await db.select().from(metricsDaily).orderBy(desc(metricsDaily.date)).limit(30)

  const maxCreated = Math.max(1, ...rows.map((r) => r.tasksCreated))

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Metrics — last 30 days</h1>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No metrics yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2">Date</th>
                  <th className="text-right">Created</th>
                  <th className="text-right">Completed</th>
                  <th className="text-right">Failed</th>
                  <th className="text-right">Success rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 7).map((r) => {
                  const total = r.tasksCompleted + r.tasksFailed
                  const rate = total > 0 ? ((r.tasksCompleted / total) * 100).toFixed(1) + '%' : '—'
                  return (
                    <tr key={r.date} className="border-b">
                      <td className="py-1.5">{r.date}</td>
                      <td className="text-right">{r.tasksCreated}</td>
                      <td className="text-right">{r.tasksCompleted}</td>
                      <td className="text-right">{r.tasksFailed}</td>
                      <td className="text-right">{rate}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">7-day volume</div>
            {rows.slice(0, 7).map((r) => (
              <div key={r.date} className="flex items-center gap-2">
                <span className="text-xs w-24">{r.date}</span>
                <div
                  className="h-3 bg-primary rounded"
                  style={{
                    width: `${(r.tasksCreated / maxCreated) * 100}%`,
                    minWidth: r.tasksCreated > 0 ? '8px' : '0',
                  }}
                />
                <span className="text-xs text-muted-foreground">{r.tasksCreated}</span>
              </div>
            ))}
          </div>
          {rows.length > 7 && (
            <details className="text-sm">
              <summary className="cursor-pointer">Show all 30 days</summary>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2">Date</th>
                    <th className="text-right">Created</th>
                    <th className="text-right">Completed</th>
                    <th className="text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(7).map((r) => (
                    <tr key={r.date} className="border-b">
                      <td className="py-1.5">{r.date}</td>
                      <td className="text-right">{r.tasksCreated}</td>
                      <td className="text-right">{r.tasksCompleted}</td>
                      <td className="text-right">{r.tasksFailed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
