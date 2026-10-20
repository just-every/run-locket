// The app's frame, as the picked workspace draws it: a top bar with the mark,
// the breadcrumb and the page's own tools; a slim icon rail (bottom tabs on a
// phone); and the command bar along the bottom with search, the agent's chip
// and who is signed in. A page fills the top tools and the agent's chip through
// the slots below; every other page shows the agent's waiting proposals. Search
// runs from any page: typing away from the board opens the board with the matches.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LocketState } from './api'
import { Avatar, Icon, type IconName } from './controls'
import { plural, roleLabel, stamp } from './format'

export const sections: { id: string; title: string; icon: IconName }[] = [
  { id: 'portfolio', title: 'Portfolio', icon: 'pulse' },
  { id: 'agreements', title: 'Agreements', icon: 'document' },
  { id: 'library', title: 'Library', icon: 'book' },
  { id: 'renewals', title: 'Renewals', icon: 'calendar' },
  { id: 'notifications', title: 'Notifications', icon: 'inbox' },
  { id: 'proposals', title: 'Proposals', icon: 'inbox' },
  { id: 'imports', title: 'Imports', icon: 'upload' },
  { id: 'activity', title: 'Activity', icon: 'pulse' },
]

type Slots = { tools: HTMLElement | null; agent: HTMLElement | null }
const SlotContext = createContext<Slots>({ tools: null, agent: null })
/** Tools a page puts in the top bar (the workspace's version chips). */
export function TopTools({ children }: { children: ReactNode }) {
  const { tools } = useContext(SlotContext)
  return tools ? createPortal(children, tools) : null
}
/** What a page puts in the command bar's agent place. */
export function AgentPlace({ children }: { children: ReactNode }) {
  const { agent } = useContext(SlotContext)
  return agent ? createPortal(children, agent) : null
}

export function Shell({ active, board, crumb, state, query, onQuery, onSignOut, children }: { active: string; board: boolean; crumb: ReactNode; state: LocketState | null; query: string; onQuery: (q: string) => void; onSignOut: () => void; children: ReactNode }) {
  const [tools, setTools] = useState<HTMLElement | null>(null)
  const [agent, setAgent] = useState<HTMLElement | null>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const waiting = state?.proposals.filter(p => p.status === 'pending').length ?? 0
  const agentName = state?.operators.find(o => o.role === 'agent')?.name ?? 'Agent'
  return (
    <SlotContext.Provider value={{ tools, agent }}>
      <div className="lk-app">
        <header className="lk-top">
          <a className="lk-brand" href="#agreements"><img src="/brand/mark.svg" alt="" /><span data-rer-name>Locket</span></a>
          <div className="lk-crumb">{crumb}</div>
          <div className="lk-top-tools" ref={setTools} />
        </header>
        <nav className="lk-rail" aria-label="Locket">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className={s.id === active ? 'lk-active' : undefined} aria-current={s.id === active ? 'page' : undefined}>
              <Icon name={s.icon} /><span>{s.title}</span>
            </a>
          ))}
          {state && <span className="lk-rail-me" aria-hidden="true"><Avatar name={state.actor.name} large /></span>}
        </nav>
        <div className="lk-body">
          {children}
          <footer className="lk-command">
            <label className="lk-ask">
              <img src="/brand/mark.svg" alt="" />
              <span className="lk-visually-hidden">Search agreements you can access</span>
              <input ref={search} type="search" value={query} placeholder="Search agreements…" onChange={e => { onQuery(e.target.value); if (!board) window.location.hash = 'agreements' }} />
              <kbd>⌘ K</kbd>
            </label>
            <div className="lk-agent-slot" ref={setAgent} />
            <a className="lk-agent-chip lk-agent-default" href="#proposals">
              <img src="/brand/mark.svg" alt="" />
              <span>{agentName}: {waiting ? `${plural(waiting, 'proposal')} waiting for a decision` : 'no proposals waiting'}</span>
              <Icon name="arrow" />
            </a>
            {state && <Account state={state} onSignOut={onSignOut} />}
          </footer>
        </div>
      </div>
    </SlotContext.Provider>
  )
}

function Account({ state, onSignOut }: { state: LocketState; onSignOut: () => void }) {
  return (
    <details className="lk-account">
      <summary>
        <Avatar name={state.actor.name} />
        <span><span className="lk-account-name"><strong>{state.actor.name}</strong> <span className="lk-muted">{roleLabel[state.actor.role]}</span></span><small>{stamp(state.now, { year: true })}</small></span>
      </summary>
      <div className="lk-account-menu">
        <p><strong>{state.actor.name}</strong><small>{roleLabel[state.actor.role]}</small></p>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </details>
  )
}
