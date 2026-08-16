'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Send, Loader2 } from 'lucide-react'

export function SteerInput({ taskId, taskStatus }: { taskId: string; taskStatus: string }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  if (taskStatus !== 'processing') return null

  const handleSend = async () => {
    const trimmed = message.trim()
    if (!trimmed || sending || cooldown > 0) return
    setSending(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429) {
          toast.error('Too many steering messages — wait 5s')
          setCooldown(5)
        } else {
          toast.error(data.error || 'Failed to steer')
        }
        return
      }
      setMessage('')
      setCooldown(5)
      toast.success('Steering message sent')
    } catch {
      toast.error('Failed to send steering message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Steer the agent mid-run</div>
      <div className="flex gap-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Guide the agent — e.g. use a different approach..."
          className="min-h-[44px] text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!message.trim() || sending || cooldown > 0}
          className="self-end"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : cooldown > 0 ? (
            `Wait ${cooldown}s`
          ) : (
            <>
              <Send className="h-4 w-4 mr-1" /> Steer
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
