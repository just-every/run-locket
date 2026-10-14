import { useEffect, useState } from 'react'
import { useLocket } from './api'
import { Activity } from './activity'
import { AgreementPage } from './agreement'
import { Imports } from './imports'
import { Intake, LegacyImport } from './intake'
import { Library } from './library'
import { Proposals } from './proposals'
import { Register } from './register'
import { Renewals } from './renewals'
import { roleLabel } from './format'
import './style'

const tabs = [
  { id: 'agreements', title: 'Agreements' },
  { id: 'library', title: 'Library' },
  { id: 'renewals', title: 'Renewals' },
  { id: 'proposals', title: 'Proposals' },
  { id: 'imports', title: 'Imports' },
  { id: 'activity', title: 'Activity' },
]
const section = (view: string) => (['agreement', 'new', 'import-signed'].includes(view) ? 'agreements' : view)

function readHash() {
  const [view = 'agreements', id = '', tab = ''] = window.location.hash.slice(1).split('/')
  return { view: view || 'agreements', id, tab }
}

export function LocketApp() {
  const locket = useLocket()
  const { state, error, setError, notice, setNotice, busy } = locket
  const [route, setRoute] = useState({ view: 'agreements', id: '', tab: '' })
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
  return (
    <div className="lk-app">
      <header className="lk-header">
        <a className="lk-brand" href="#agreements"><img src="/brand/mark.svg" alt="" />Locket</a>
        <nav aria-label="Locket">
          {tabs.map(t => <a key={t.id} href={`#${t.id}`} className={t.id === active ? 'lk-active' : undefined} aria-current={t.id === active ? 'page' : undefined}>{t.title}</a>)}
        </nav>
        <div className="lk-account">
          <span className="lk-account-name">{state?.actor.name ?? 'Signed in'}<small>{state ? roleLabel[state.actor.role] : ''}</small></span>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <main className="lk-main" aria-busy={busy}>
        {error && <div className="lk-alert" role="alert"><strong>That did not go through.</strong> {error} <button type="button" onClick={() => void locket.refresh()}>Reload records</button></div>}
        {notice && <div className="lk-note" role="status">{notice}</div>}
        {!state ? <p className="lk-empty">{error ? 'Locket could not load your agreements. Sign in again if your session ended.' : 'Loading agreements…'}</p> : (
          <>
            {route.view === 'agreements' && <Register state={state} />}
            {route.view === 'agreement' && <AgreementPage key={route.id} state={state} id={route.id} tab={route.tab} locket={locket} />}
            {route.view === 'new' && <Intake state={state} locket={locket} />}
            {route.view === 'import-signed' && <LegacyImport state={state} locket={locket} />}
            {route.view === 'library' && <Library state={state} locket={locket} />}
            {route.view === 'renewals' && <Renewals state={state} locket={locket} />}
            {route.view === 'proposals' && <Proposals state={state} locket={locket} />}
            {route.view === 'imports' && <Imports state={state} locket={locket} />}
            {route.view === 'activity' && <Activity state={state} locket={locket} />}
          </>
        )}
      </main>
    </div>
  )
}
export type Locket = ReturnType<typeof useLocket>
