// ── Score data returned by the backend ───────────────────────────────────
export interface ScoreData {
  id: number
  title: string
  composer: string | null
  tempo: number
  sourceXml: string
}

export interface ScoreSummary {
  id: string
  title: string
  composer: string | null
  tempo: number
  noteCount: number
}

export interface SessionRecord {
  id: string
  scoreId: string
  startedAt: number
  endedAt: number
  pitchAccuracy: number
  rhythmAccuracy: number
  durationSec: number
  completed: boolean
}

export class ApiError extends Error {
  readonly detail?: string
  readonly status?: number
  constructor(message: string, detail?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.detail = detail
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error ?? `Request failed (${res.status})`, body.detail, res.status)
  }
  return res.json() as Promise<T>
}

export async function fetchScores(): Promise<ScoreSummary[]> {
  const data = await handle<{ scores: ScoreSummary[] }>(await fetch('/api/scores'))
  return data.scores
}

export async function fetchScore(id: string): Promise<ScoreData> {
  return handle<ScoreData>(await fetch(`/api/scores/${id}`))
}

export async function importScore(file: File): Promise<ScoreSummary> {
  const form = new FormData()
  form.append('file', file)
  return handle<ScoreSummary>(await fetch('/api/import', { method: 'POST', body: form }))
}

export async function deleteScore(id: string): Promise<void> {
  await handle<{ deleted: boolean }>(await fetch(`/api/scores/${id}`, { method: 'DELETE' }))
}

export async function fetchSessions(scoreId: string): Promise<SessionRecord[]> {
  const data = await handle<{ sessions: SessionRecord[] }>(await fetch(`/api/scores/${scoreId}/sessions`))
  return data.sessions
}

export interface NewSession {
  startedAt: number
  endedAt: number
  pitchAccuracy: number
  rhythmAccuracy: number
  durationSec: number
  practiceMode: 'right' | 'left' | 'both'
}

export async function recordSession(scoreId: string, s: NewSession): Promise<string> {
  const data = await handle<{ id: string }>(
    await fetch(`/api/scores/${scoreId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }),
  )
  return data.id
}
