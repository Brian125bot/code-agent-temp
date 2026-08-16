import { createHash } from 'crypto'
import { generateText } from 'ai'
import { db } from '@/lib/db/client'
import { tasks, audioSummaries } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { GATEWAY_DEFAULT_MODEL } from '@/lib/constants'

export async function generateAudioSummary(taskId: string): Promise<{ blobUrl: string; transcript: string } | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return null
  const status = task.status as string
  if (status !== 'completed' && !task.prUrl) return null

  let diff = ''
  try {
    const { getOctokit, parseGitHubUrl } = await import('@/lib/github/client')
    const parsed = task.repoUrl ? parseGitHubUrl(task.repoUrl) : null
    if (parsed && task.branchName) {
      const octokit = await getOctokit()
      const auth = (octokit as unknown as { auth?: unknown }).auth
      if (auth) {
        try {
          const compare = await octokit.rest.repos.compareCommits({
            owner: parsed.owner,
            repo: parsed.repo,
            base: 'main',
            head: task.branchName,
          })
          diff = (compare.data.files || [])
            .map((f) => `--- ${f.filename}\n${(f.patch || '').slice(0, 3000)}`)
            .join('\n')
            .slice(0, 8000)
        } catch {}
        if (!diff && task.prNumber) {
          try {
            const pr = await octokit.rest.pulls.get({
              owner: parsed.owner,
              repo: parsed.repo,
              pull_number: task.prNumber,
            })
            diff = (pr.data.body || '').slice(0, 8000)
          } catch {}
        }
      }
    }
  } catch {}

  if (!diff) diff = task.prompt.slice(0, 4000)

  const diffHash = createHash('sha256').update(diff).digest('hex').slice(0, 16)
  const modelVersion = `${GATEWAY_DEFAULT_MODEL}:tts`

  const existing = await db
    .select()
    .from(audioSummaries)
    .where(
      and(
        eq(audioSummaries.taskId, taskId),
        eq(audioSummaries.diffHash, diffHash),
        eq(audioSummaries.modelVersion, modelVersion),
      ),
    )
    .limit(1)
  if (existing[0]) {
    return { blobUrl: existing[0].blobUrl, transcript: existing[0].transcript }
  }

  let transcript = ''
  try {
    const result = await generateText({
      model: GATEWAY_DEFAULT_MODEL,
      prompt: `Explain what this PR does in plain language, like to a junior dev. Mention the why, not just the what. 60-90 seconds when spoken.\n\nDiff:\n${diff.slice(0, 6000)}`,
    } as unknown as Parameters<typeof generateText>[0])
    transcript = ((result as unknown as { text?: string }).text || '').slice(0, 2000) || 'Changes completed.'
  } catch {
    transcript = 'Changes completed.'
  }

  let blobUrl: string | null = null

  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: transcript,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      })
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        const { put } = await import('@vercel/blob')
        const blob = await put(`audio/${taskId}-${diffHash}.mp3`, buffer, {
          access: 'public',
          contentType: 'audio/mpeg',
        })
        blobUrl = blob.url
      }
    } catch {}
  }

  if (!blobUrl) {
    try {
      const { put } = await import('@vercel/blob')
      const textBuffer = Buffer.from(transcript, 'utf-8')
      const blob = await put(`audio/${taskId}-${diffHash}.txt`, textBuffer, {
        access: 'public',
        contentType: 'text/plain',
      })
      blobUrl = blob.url
    } catch {
      return null
    }
  }

  const wordCount = transcript.split(/\s+/).length
  const durationSec = Math.max(10, Math.round(wordCount / 2.5))

  try {
    await db.insert(audioSummaries).values({
      id: generateId(12),
      taskId,
      blobUrl: blobUrl as string,
      transcript,
      durationSec,
      modelVersion,
      diffHash: diffHash as string,
    })
  } catch {}

  try {
    if (task.prUrl && blobUrl) {
      const { getOctokit, parseGitHubUrl } = await import('@/lib/github/client')
      const parsed = task.repoUrl ? parseGitHubUrl(task.repoUrl) : null
      if (parsed && task.prNumber) {
        const octokit = await getOctokit()
        const auth = (octokit as unknown as { auth?: unknown }).auth
        if (auth) {
          try {
            await octokit.rest.issues.createComment({
              owner: parsed.owner,
              repo: parsed.repo,
              issue_number: task.prNumber,
              body: `🎧 [Listen](${blobUrl}) (${durationSec}s) — AI-generated changelog\n\n${transcript.slice(0, 500)}`,
            })
          } catch {}
        }
      }
    }
  } catch {}

  return { blobUrl: blobUrl as string, transcript }
}
