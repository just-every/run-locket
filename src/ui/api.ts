import { useCallback, useEffect, useRef, useState } from 'react'

export type Row = { id: string; [key: string]: any }
export interface LocketState {
  actor: { id: string; name: string; role: string }
  portfolio: import('../locket/portfolio').Portfolio
  now: number
  operators: Row[]
  parties: Row[]
  entities: Row[]
  agreements: Row[]
  routes: Record<string, { kind: string; deviationId: string | null; label: string; roles: string[] }[]>
  requirements: Row[]
  versions: Row[]
  artifacts: Row[]
  comments: Row[]
  templates: Row[]
  templateVersions: Row[]
  playbooks: Row[]
  deviations: Row[]
  approvals: Row[]
  approvalReminders: {
    settings: { firstAfterDays: number; repeatEveryDays: number; escalateAfterDays: number; escalationContactId: string | null }
    preferences: Row[]
    pending: { agreementId: string; versionId: string; approverId: string; requestedAt: number; timezone: string; nextReminderAt: number; escalateAt: number; manualAvailableAt: number | null }[]
    sent: Row[]
  }
  packages: Row[]
  executions: Row[]
  clickwrapTerms: Row[]
  clickwrapVersions: Row[]
  savedViews: Row[]
  familyTerms: Row[]
  terms: Row[]
  obligations: Row[]
  renewals: Row[]
  reminderSchedules: Row[]
  reminderOperations: import('../locket/bulk-reminder-operations').ReminderOperation[]
  noticeLetters: Row[]
  noticeDispatches: Row[]
  noticeEvents: Row[]
  noticeTracking: Row[]
  notices: Row[]
  proposals: Row[]
  imports: Row[]
  access: Row[]
  audit: Row[]
}
export type Run = (type: string, payload: object) => Promise<any | null>

class Failure extends Error {
  constructor(message: string, public code: string, public details: unknown) {
    super(message)
  }
}

async function read(response: Response) {
  const body: any = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) throw new Failure(body?.error?.message ?? 'Locket could not answer. Reload and try again.', body?.error?.code ?? 'HTTP', body?.error?.details ?? null)
  return body
}

/** The workspace's data and its one command door. A retry after a lost
 * response reuses the same command identity, so it can never apply twice. */
export function useLocket() {
  const [state, setState] = useState<LocketState | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ signature: string; id: string } | null>(null)
  const refresh = useCallback(async () => {
    try {
      setState(await read(await fetch('/api/locket/state', { credentials: 'same-origin', cache: 'no-store' })))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const run: Run = async (type, payload) => {
    if (busy) return null
    const signature = JSON.stringify({ type, payload })
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() }
    setBusy(true); setError(''); setNotice('')
    try {
      const body = await read(await fetch('/api/locket/commands', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: pending.current.id, type, payload }) }))
      pending.current = null
      await refresh()
      setNotice('Saved.')
      return body.mailReceipt ? { ...body.result, mailReceipt: body.mailReceipt } : body.result
    } catch (cause) {
      const failure = cause as Failure
      if (failure.code !== 'HTTP') pending.current = null
      setError(failure.message)
      return null
    } finally {
      setBusy(false)
    }
  }
  return { state, error, setError, notice, setNotice, busy, run, refresh }
}

export async function fetchJson<T = any>(path: string): Promise<T> {
  return read(await fetch(path, { credentials: 'same-origin', cache: 'no-store' }))
}

export function fileToPayload(file: File): Promise<{ filename: string; mediaType: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
    reader.onload = () => resolve({ filename: file.name, mediaType: file.type || 'application/octet-stream', base64: String(reader.result).split(',')[1] ?? '' })
    reader.readAsDataURL(file)
  })
}
