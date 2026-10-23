import { ApprovalChannelReview } from './approval-channel-review'
import { ApprovalChannelInbox } from './approval-channel-settings'
import { OutcomeReports } from './outcome-report'
import { RequestQueue } from './request-queue'
import { Counterparty } from './counterparty'
import { useEffect, useState } from 'react'
import { useLocket } from './api'
import { Clickwrap } from './clickwrap'
import { Activity } from './activity'
import { AgreementPage } from './agreement'
import { Imports } from './imports'
import { Intake, LegacyImport } from './intake'
import { Library } from './library'
import { Proposals } from './proposals'
import { Portfolio } from './portfolio'
import { Register } from './register'
import { Renewals } from './renewals'
import { Notifications } from './notifications'
import { money, partyName } from './format'
import { sections, Shell } from './shell'
import './style'

const section = (view: string) => (['agreement', 'counterparty', 'new', 'import-signed', 'queue'].includes(view) ? 'agreements' : view === 'clickwrap' ? 'library' : view)
const pageTitle: Record<string, string> = { new: 'New request', 'import-signed': 'Import a signed file' }

/** #view/id/tab/version: a section, or one agreement with its tab and the version shown. */
function readHash() {
  const [view = 'portfolio', id = '', tab = '', shown = '', start = '', end = ''] = window.location.hash.slice(1).split('/')
  return { view: view || 'portfolio', id, tab, shown, start, end }
}

export function LocketApp() {
  const locket = useLocket()
  const { state, error, setError, notice, setNotice, busy } = locket
  const [route, setRoute] = useState({ view: 'agreements', id: '', tab: '', shown: '', start: '', end: '' })
  const [query, setQuery] = useState('')
  useEffect(() => {
    const update = () => { setRoute(readHash()); setError(''); setNotice(''); window.scrollTo(0, 0) }
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [setError, setNotice])
  async function signOut() {
    const response = await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
    if (response?.ok) window.location.href = '/signin'
    else setError('Sign out could not be confirmed. Reload and try again.')
  }
  const active = section(route.view)
  const agreement = route.view === 'agreement' ? state?.agreements.find(a => a.id === route.id) : null
  const title = sections.find(s => s.id === active)?.title ?? 'Agreements'
  const crumb = agreement && state ? (
    <><a href="#agreements"><strong>Agreements</strong></a><span> / {partyName(state, agreement.party_id)} / </span><span>{agreement.title}{agreement.value_cents !== null ? ` · ${money(agreement.value_cents)}` : ''}</span></>
  ) : pageTitle[route.view] ? <><a href="#agreements"><strong>Agreements</strong></a><span> / {pageTitle[route.view]}</span></> : <strong>{title}</strong>
  return (
    <Shell active={active} board={route.view === 'agreements'} crumb={crumb} state={state} query={query} onQuery={setQuery} onSignOut={() => void signOut()}>
      <main className="lk-main" aria-busy={busy}>
        {error && <div className="lk-alert" role="alert"><strong>That did not go through.</strong> {error} <button type="button" onClick={() => void locket.refresh()}>Reload records</button></div>}
        {notice && <div className="lk-note" role="status">{notice}</div>}
        {!state ? <p className="lk-empty">{error ? 'Locket could not load your agreements. Sign in again if your session ended.' : 'Loading agreements…'}</p> : (
          <>
            {route.view === 'approval-request' && <ApprovalChannelReview id={route.id} locket={locket}/>}
            {route.view === 'approval-word' && <ApprovalChannelInbox state={state}/>}
            {route.view === 'outcome-report' && <OutcomeReports state={state} locket={locket} month={route.id} />}
            {route.view === 'queue' && <RequestQueue state={state} locket={locket} />}
            {route.view === 'portfolio' && <Portfolio state={state} />}
            {route.view === 'agreements' && <Register state={state} locket={locket} query={query} portfolioFilter={route.id === 'portfolio' ? route.tab : ''} />}
            {route.view === 'agreement' && <AgreementPage key={route.id} state={state} id={route.id} tab={route.tab} shown={route.shown} passage={{ start: route.start, end: route.end }} locket={locket} />}
            {route.view === 'counterparty' && <Counterparty key={route.id} state={state} id={route.id} locket={locket} />}
            {route.view === 'new' && <Intake state={state} locket={locket} />}
            {route.view === 'import-signed' && <LegacyImport state={state} locket={locket} />}
            {route.view === 'clickwrap' && <Clickwrap state={state} locket={locket} />}
            {route.view === 'library' && <Library state={state} locket={locket} />}
            {route.view === 'renewals' && <Renewals state={state} locket={locket} />}
            {route.view === 'notifications' && <Notifications state={state} locket={locket} />}
            {route.view === 'proposals' && <Proposals state={state} locket={locket} />}
            {route.view === 'imports' && <Imports state={state} locket={locket} />}
            {route.view === 'activity' && <Activity state={state} locket={locket} />}
          </>
        )}
      </main>
    </Shell>
  )
}
export type Locket = ReturnType<typeof useLocket>
