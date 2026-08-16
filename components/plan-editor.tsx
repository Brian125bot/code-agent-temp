'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Check, Pencil, Loader2 } from 'lucide-react'
import type { Plan } from '@/lib/db/schema'
import { planSchema } from '@/lib/plans/schema'

interface PlanEditorProps {
  taskId: string
  plan: Plan
  taskStatus: string
  onUpdated?: () => void
  onApproved?: () => void
}

export function PlanEditor({ taskId, plan, taskStatus, onUpdated, onApproved }: PlanEditorProps) {
  const content = plan.content as unknown as Record<string, unknown>
  const [raw, setRaw] = useState(JSON.stringify(content, null, 2))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAwaiting = taskStatus === 'awaiting_approval'

  const handleSave = async () => {
    setError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError('Invalid JSON')
      return
    }
    const result = planSchema.safeParse(parsed)
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to save plan')
        toast.error(data.error || 'Failed to save plan')
        return
      }
      toast.success('Plan saved')
      setEditing(false)
      setRaw(JSON.stringify(data.plan.content, null, 2))
      onUpdated?.()
    } catch {
      setError('Failed to save plan')
      toast.error('Failed to save plan')
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to approve')
        toast.error(data.error || 'Failed to approve')
        return
      }
      toast.success('Plan approved — execution started')
      onApproved?.()
    } catch {
      setError('Failed to approve')
      toast.error('Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  const goal = (content.goal as string) || ''
  const assumptions = (content.assumptions as string[]) || []
  const steps =
    (content.steps as Array<{ id: string; action: string; files?: string[]; rationale: string; risk: string }>) || []

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Plan v{plan.version}</h3>
        <span className="text-xs text-muted-foreground">by {plan.authoredBy}</span>
      </div>

      {!editing ? (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Goal</div>
            <div className="text-sm mt-1">{goal}</div>
          </div>
          {assumptions.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Assumptions</div>
              <ul className="text-xs list-disc ml-4 mt-1 space-y-1">
                {assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-muted-foreground">Steps</div>
            <div className="mt-2 space-y-2">
              {steps.map((s) => (
                <div key={s.id} className="border rounded p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{s.id}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase">{s.action}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${s.risk === 'high' ? 'bg-red-500/20 text-red-600' : s.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-600' : 'bg-green-500/20 text-green-600'}`}
                    >
                      {s.risk}
                    </span>
                  </div>
                  {s.files && s.files.length > 0 && (
                    <div className="font-mono text-[11px] mt-1 text-muted-foreground">{s.files.join(', ')}</div>
                  )}
                  <div className="mt-1 text-muted-foreground">{s.rationale}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>Files: {String(content.estimated_files_changed ?? '?')}</span>
            <span>LOC: {String(content.estimated_loc ?? '?')}</span>
            {content.test_command ? <span className="font-mono">{String(content.test_command)}</span> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} className="font-mono text-xs min-h-[300px]" />
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
      )}

      {error && !editing && <div className="text-xs text-red-500">{error}</div>}

      {isAwaiting && (
        <div className="flex gap-2">
          {!editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setRaw(JSON.stringify(content, null, 2))
                  setError(null)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null} Save
              </Button>
            </>
          )}
          <Button size="sm" onClick={handleApprove} disabled={approving || editing}>
            {approving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />} Approve
            & Run
          </Button>
        </div>
      )}
    </Card>
  )
}
