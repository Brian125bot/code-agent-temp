'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { AudioSummary } from '@/lib/db/schema'

export function AudioPlayer({ taskId, initialAudio }: { taskId: string; initialAudio?: AudioSummary | null }) {
  const [audio, setAudio] = useState<AudioSummary | null>(() => initialAudio || null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (audio)
      return () => {
        cancelled = false
      }
    const fetchAudio = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/audio`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.audio) setAudio(data.audio)
      } catch {}
    }
    fetchAudio()
    const id = setInterval(fetchAudio, 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [taskId, audio])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/audio`, { method: 'POST' })
      if (res.status === 202) {
        setTimeout(async () => {
          try {
            const r = await fetch(`/api/tasks/${taskId}/audio`)
            const d = await r.json()
            if (d.audio) setAudio(d.audio)
          } catch {}
          setGenerating(false)
        }, 5000)
      } else if (res.ok) {
        const data = await res.json()
        if (data.audio) setAudio(data.audio)
        setGenerating(false)
      } else {
        setGenerating(false)
      }
    } catch {
      setGenerating(false)
    }
  }

  if (!audio) {
    return (
      <Card className="p-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">No audio changelog yet</span>
        <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null} Generate
        </Button>
      </Card>
    )
  }

  const isAudio = audio.blobUrl.endsWith('.mp3') || audio.blobUrl.includes('audio')

  return (
    <Card className="p-3 space-y-2">
      <div className="text-xs font-medium">🎧 Audio Changelog {audio.durationSec ? `(${audio.durationSec}s)` : ''}</div>
      {isAudio ? (
        <audio controls src={audio.blobUrl} preload="none" className="w-full" />
      ) : (
        <a
          href={audio.blobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          View transcript file
        </a>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Transcript</summary>
        <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{audio.transcript}</div>
      </details>
    </Card>
  )
}
