'use client'

import { useState, useMemo } from 'react'
import { useTask } from '@/lib/hooks/use-task'
import { TaskDetails } from '@/components/task-details'
import { SharedHeader } from '@/components/shared-header'
import { TaskActions } from '@/components/task-actions'
import { LogsPane } from '@/components/logs-pane'
import { PlanEditor } from '@/components/plan-editor'
import { AudioPlayer } from '@/components/audio-player'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { RotateCcw, Loader2 } from 'lucide-react'
import type { Session } from '@/lib/session/types'

interface TaskPageClientProps {
  taskId: string
  user: Session['user'] | null
  authProvider: Session['authProvider'] | null
  initialStars?: number
  maxSandboxDuration?: number
}

function parseRepoFromUrl(repoUrl: string | null): { owner: string; repo: string } | null {
  if (!repoUrl) return null
  try {
    const url = new URL(repoUrl)
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/, ''),
      }
    }
    return null
  } catch {
    return null
  }
}

export function TaskPageClient({
  taskId,
  user,
  authProvider,
  initialStars = 1200,
  maxSandboxDuration = 300,
}: TaskPageClientProps) {
  const { task, plan, audioSummary, isLoading, error, refetch } = useTask(taskId)
  const [logsPaneHeight, setLogsPaneHeight] = useState(40)
  const [retrying, setRetrying] = useState(false)

  const repoInfo = useMemo(() => parseRepoFromUrl(task?.repoUrl ?? null), [task?.repoUrl])

  const headerLeftActions = repoInfo ? (
    <div className="flex items-center gap-2 min-w-0">
      <h1 className="text-lg font-semibold truncate">
        {repoInfo.owner}/{repoInfo.repo}
      </h1>
    </div>
  ) : null

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to retry')
        return
      }
      toast.success('Task retry started')
      refetch()
    } catch {
      toast.error('Failed to retry')
    } finally {
      setRetrying(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 bg-background">
        <div className="p-3">
          <SharedHeader initialStars={initialStars} />
        </div>
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="flex-1 bg-background">
        <div className="p-3">
          <SharedHeader initialStars={initialStars} />
        </div>
        <div className="mx-auto p-3">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <h2 className="text-lg font-semibold mb-2">Task Not Found</h2>
              <p className="text-muted-foreground">{error || 'The requested task could not be found.'}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-background relative flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 border-b">
        <SharedHeader
          leftActions={headerLeftActions}
          initialStars={initialStars}
          extraActions={<TaskActions task={task} />}
        />
      </div>

      {plan && (
        <div className="px-3 py-2 flex-shrink-0">
          <PlanEditor taskId={taskId} plan={plan} taskStatus={task.status} onUpdated={refetch} onApproved={refetch} />
        </div>
      )}

      {task.status === 'awaiting_approval' && !plan && (
        <div className="px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Generating plan...
          </div>
        </div>
      )}

      {(task.status === 'error' || task.status === 'stopped') && (
        <div className="px-3 py-2">
          <Button size="sm" variant="outline" onClick={handleRetry} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}{' '}
            Retry
          </Button>
        </div>
      )}

      {task.status === 'completed' && (
        <div className="px-3 py-2">
          <AudioPlayer taskId={taskId} initialAudio={audioSummary} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ paddingBottom: `${logsPaneHeight}px` }}>
        <TaskDetails task={task} maxSandboxDuration={maxSandboxDuration} />
      </div>

      <LogsPane task={task} onHeightChange={setLogsPaneHeight} />
    </div>
  )
}
