// The workspace's page: the shown version as one tall serif page with the
// changes from the earlier version tracked inline, unchanged sections folded,
// and the findings and comments as margin notes on dotted connectors beside
// the clauses they cite. On a wide screen the margin starts beside the file
// head, and when the open decision's clause is further down than the first view
// reaches, the decision and the notes before it rise in the margin so the head
// and the decision with its buttons share the first view, unscrolled. Below
// 1100 px the notes fold under their clauses, and the settled sections before
// the open decision fold too, so the breach note comes first.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Icon } from './controls'
import { Tooltip } from './tooltip'
import { plural } from './format'
import { findingTone, NoteCard, type Note } from './notes'
import { cut, redline, type Paragraph, type Section } from './redline'

const order: Record<string, number> = { open: 0, breach: 1, unsure: 2, accepted: 3, met: 4, internal: 5 }
const color: Record<string, string> = { open: 'var(--lk-bad)', breach: 'var(--lk-bad)', unsure: 'var(--lk-warn)', accepted: 'var(--lk-decided)', met: 'var(--lk-good)', internal: 'var(--lk-internal)' }
const WIDE = '(min-width: 1100px)'
const GAP = 14

export function useRedline(base: Row | null, shown: Row | null) {
  return useMemo(() => (shown?.text ? redline(base?.text ?? null, shown.text) : null), [base?.text, shown?.text])
}

/** The notes on a version: every finding that is not met, a met finding where the version swapped a term (the
 * playbook's verdict on that swap), and comments whose quote is on the page. */
export function notesFor(state: LocketState, a: Row, shown: Row, swapped: (start: number, end: number) => boolean): Note[] {
  const notes: Note[] = []
  for (const d of state.deviations.filter(x => x.version_id === shown.id)) {
    const tone = findingTone(state, a, d)
    if (d.result !== 'met' || swapped(d.start_offset, d.end_offset)) notes.push({ id: `f-${d.id}`, kind: 'finding', tone, start: d.start_offset, end: d.end_offset, row: d })
  }
  for (const c of state.comments.filter(x => x.version_id === shown.id && !x.parent_id && x.quote)) {
    const start = shown.text.indexOf(c.quote)
    if (start >= 0) notes.push({ id: `c-${c.id}`, kind: 'comment', tone: 'internal', start, end: start + c.quote.length, row: c })
  }
  return notes
}

export function DocumentPage({ state, a, base, shown: sourceShown, passage, locket }: { state: LocketState; a: Row; base: Row | null; shown: Row; passage: { start: string; end: string; renditionId?:string }; locket: Locket }) {
  const rendition=state.pdfRenditions.find(r=>r.version_id===sourceShown.id&&['ready','partial'].includes(r.status)&&(!passage.start||r.id===passage.renditionId))
  const shown=useMemo(()=>rendition?{...sourceShown,text:rendition.text}:passage.renditionId?{...sourceShown,text:null}:sourceShown,[sourceShown,rendition,passage.renditionId])
  const marked = useRedline(rendition?null:base, shown)
  const start = /^\d+$/.test(passage.start) ? Number(passage.start) : -1
  const end = /^\d+$/.test(passage.end) ? Number(passage.end) : -1
  const pdfPage=rendition?.pages.find(p=>start>=p.start&&end<=p.end)
  const pdfPosition=pdfPage?.anchors.find(p=>p.start<=start&&p.end>=end)
  const hit = start >= 0 && end > start && end <= (shown.text?.length ?? 0) ? { start, end } : null
  useEffect(() => {
    if (hit) paper.current?.querySelector('[data-search-hit]')?.scrollIntoView({ block: 'center' })
  }, [shown.id, passage.start, passage.end, marked])
  const [opened, setOpened] = useState<Set<number>>(new Set())
  const paper = useRef<HTMLDivElement>(null)
  const [links, setLinks] = useState<{ d: string; tone: string }[]>([])
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const query = window.matchMedia(WIDE), change = () => setWide(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const paragraphs = marked?.sections.flatMap(s => s.paragraphs) ?? []
  const within = (p: Paragraph, start: number) => p.segments.length > 0 && p.start <= start && start <= p.end && p.segments.some(s => s.op !== 'del')
  const notes = useMemo(() => rendition?[]:notesFor(state, a, shown, start => paragraphs.some(p => within(p, start) && p.segments.some(s => s.op === 'del') && p.segments.some(s => s.op === 'add'))), [state, a, shown, marked, rendition])
  const inPara = (p: Paragraph) => notes.filter(n => within(p, n.start)).sort((x, y) => order[x.tone] - order[y.tone])
  // Rules met on the other changed clauses read as a tick beside the clause.
  const ticks = (p: Paragraph) => (!rendition && p.changed ? state.deviations.filter(d => d.version_id === shown.id && d.result === 'met' && within(p, d.start_offset) && !notes.some(n => n.row.id === d.id)) : [])

  // Margin notes beside their clauses, stacked so none overlap, with a dotted connector from the cited words.
  useLayoutEffect(() => {
    const page = paper.current
    if (!page) return
    const place = () => {
      const cards = [...page.querySelectorAll<HTMLElement>('.lk-margin-note')]
      cards.forEach(card => { card.style.top = '' })
      page.style.minHeight = ''
      if (!window.matchMedia(WIDE).matches) { setLinks([]); return }
      const box = page.getBoundingClientRect()
      const heights = cards.map(card => card.offsetHeight)
      const wanted = cards.map(card => card.parentElement!.getBoundingClientRect().top - box.top - 56)
      const tops: number[] = []
      cards.forEach((_, i) => { tops[i] = Math.max(wanted[i], i ? tops[i - 1] + heights[i - 1] + GAP : 0) })
      // The open decision, buttons and all, ends above the command bar in the first view: when its clause is further
      // down, it rises, and the notes before it rise with it, as far as the top of the file head.
      const open = cards.findIndex(card => card.dataset.tone === 'open')
      const head = (page.closest('.lk-agreement')?.getBoundingClientRect().top ?? box.top) - box.top
      const sight = window.innerHeight - (document.querySelector<HTMLElement>('.lk-command')?.offsetHeight ?? 0) - 16 - (box.top + window.scrollY)
      if (open >= 0 && tops[open] + heights[open] > sight) {
        const room = head + heights.slice(0, open).reduce((sum, h) => sum + h + GAP, 0)
        tops[open] = Math.max(room, sight - heights[open])
        for (let i = open - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - GAP - heights[i])
        for (let i = open + 1; i < cards.length; i++) tops[i] = Math.max(wanted[i], tops[i - 1] + heights[i - 1] + GAP)
      }
      const drawn: { d: string; tone: string }[] = []
      cards.forEach((card, i) => {
        const id = card.dataset.note!, para = card.parentElement!, top = tops[i]
        card.style.top = `${top}px`
        const words = [...page.querySelectorAll<HTMLElement>(`[data-notes~="${id}"]`)]
        const end = (words.filter(w => w.tagName === 'INS').at(-1) ?? words.at(-1) ?? para.querySelector('.lk-clause-text'))?.getClientRects()
        const rect = end?.[end.length - 1]
        if (!rect) return
        // From the cited words' line, out through the page's right margin, so no connector crosses the text.
        const x1 = Math.max(rect.right - box.left + 6, page.clientWidth - 30), y1 = rect.top - box.top + rect.height / 2, x2 = card.offsetLeft - 6, y2 = top + 24
        const bend = Math.max(30, (x2 - x1) / 2)
        drawn.push({ d: `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`, tone: card.dataset.tone! })
      })
      if (cards.length) page.style.minHeight = `${tops.at(-1)! + heights.at(-1)!}px`
      setLinks(drawn)
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(page)
    window.addEventListener('resize', place)
    // A settled note opening or closing changes its height.
    page.addEventListener('toggle', place, true)
    void document.fonts?.ready.then(place)
    return () => { watch.disconnect(); window.removeEventListener('resize', place); page.removeEventListener('toggle', place, true) }
  }, [notes, opened, marked, wide])

  if (!marked) return <div className="lk-paper lk-paper-empty"><p className="lk-empty">{passage.renditionId?'This PDF passage is unavailable because its source changed or processing is incomplete.':'This version has no readable text yet. Check PDF processing, or supply text or a DOCX to compare and cite passages.'}</p></div>
  const folding = !!base && marked.changes > 0
  // Below 1100 px the sections before the open decision's, with nothing open in them, fold like unchanged ones.
  const openAt = wide ? -1 : marked.sections.findIndex(s => s.paragraphs.some(p => inPara(p).some(n => n.tone === 'open')))
  const settledBefore = (s: Section) => marked.sections.indexOf(s) < openAt && !s.paragraphs.some(p => inPara(p).some(n => n.tone === 'open' || n.tone === 'unsure'))
  const containsHit = (p: Paragraph) => !!hit && p.start < hit.end && p.end > hit.start
  const quiet = (s: Section) => !s.paragraphs.some(containsHit) && ((folding && !s.paragraphs.some(p => p.changed || inPara(p).length)) || settledBefore(s))
  const runs: { sections: Section[]; index: number }[] = []
  marked.sections.forEach((s, index) => {
    const last = runs.at(-1)
    if (quiet(s) && !opened.has(index) && last && quiet(last.sections[0]) && !opened.has(last.index)) last.sections.push(s)
    else runs.push({ sections: [s], index })
  })
  const render = (p: Paragraph, key: number) => {
    const here = inPara(p)
    const marks = [...here.flatMap(n => [n.start, n.end]), ...(hit ? [hit.start, hit.end] : [])]
    const text = cut(p.segments, marks).map((s, i) => {
      const ids = s.op === 'del' ? '' : here.filter(n => n.start < s.start + s.text.length && n.end > s.start).map(n => n.id).join(' ')
      const notes = ids || undefined
      const content = hit && s.op !== 'del' && s.start >= hit.start && s.start < hit.end ? <mark data-search-hit data-pdf-page={rendition?.pages.find(p=>s.start>=p.start&&s.start<p.end)?.page}>{s.text}</mark> : s.text
      return s.op === 'add' ? <ins key={i} data-notes={notes}>{content}</ins> : s.op === 'del' ? <del key={i}>{s.text}</del> : <span key={i} data-notes={notes}>{content}</span>
    })
    const ghost = here.find(n => n.kind === 'finding' && n.tone === 'open' && n.row.proposed_wording)
    const cards = here.map(n => (
      <div key={n.id} className="lk-margin-note" data-note={n.id} data-tone={n.tone}>
        <NoteCard note={n} clause={p.number} state={state} a={a} locket={locket} />
      </div>
    ))
    const body: ReactNode = p.kind === 'heading' ? <h2 className="lk-clause-text">§ {text}</h2>
      : p.kind === 'clause' ? <div className="lk-clause"><span className="lk-clause-number">{p.number}</span><p className="lk-clause-text">{text}{ticks(p).map(d => <span key={d.id} className="lk-met" title={d.explanation}><span className="lk-visually-hidden">Playbook rule met: </span>✓ {d.clause_key}</span>)}</p></div>
        : <p className="lk-clause-text lk-plain">{text}</p>
    return (
      <div key={key} className={`lk-para lk-para-${p.kind}`}>
        {cards}
        {body}
        {ghost && <p className="lk-ghost"><span className="lk-visually-hidden">Suggested edit: </span>{ghost.row.proposed_wording}<Icon name="restore" /></p>}
      </div>
    )
  }
  // Inside a section with changes, a run of untouched clauses folds to an ellipsis, as a marked-up page reads.
  const shownSection = (section: Section, index: number) => {
    if (!folding || opened.has(index)) return section.paragraphs.map(render)
    const out: ReactNode[] = []
    let run: Paragraph[] = []
    const close = (key: number) => {
      if (!run.length) return
      const n = run.length
      out.push(<Tooltip key={`fold-${key}`} label="Show unchanged"><button type="button" className="lk-ellipsis" onClick={() => setOpened(new Set([...opened, index]))}><span aria-hidden="true">…</span><span className="lk-visually-hidden">Show {plural(n, 'unchanged paragraph')}</span></button></Tooltip>)
      run = []
    }
    section.paragraphs.forEach((p, i) => {
      if (p.kind !== 'heading' && !p.changed && !inPara(p).length && !containsHit(p)) { run.push(p); return }
      close(i)
      out.push(render(p, i))
    })
    close(section.paragraphs.length)
    return out
  }
  return (
    <div className="lk-paper" ref={paper}>
      {pdfPage&&pdfPosition&&<p className="lk-note" aria-label="PDF passage location">Page {pdfPage.page} · <a href={`/api/locket/files/${rendition!.artifact_id}#page=${pdfPage.page}&zoom=150,${pdfPosition.x},${pdfPosition.y}`} target="_blank" rel="noreferrer">Open original page {pdfPage.page}</a></p>}
      <svg className="lk-links" aria-hidden="true">
        <defs><marker id="lk-note-endpoint" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4"><circle cx="3" cy="3" r="2" fill="context-stroke" /></marker></defs>
        {links.map((l, i) => <path key={i} d={l.d} stroke={color[l.tone]} markerStart="url(#lk-note-endpoint)" markerEnd="url(#lk-note-endpoint)" />)}
      </svg>
      {runs.map(({ sections, index }) => {
        if (!quiet(sections[0]) || opened.has(index)) return <section key={index} className="lk-section">{shownSection(sections[0], index)}</section>
        const numbered = sections.filter(s => s.number)
        const clauses = sections.reduce((n, s) => n + s.paragraphs.filter(p => p.kind !== 'heading').length, 0)
        const changes = sections.reduce((n, s) => n + s.paragraphs.filter(p => p.changed).length, 0)
        const single = numbered.length === 1 && sections.length === 1
        const unfold = () => setOpened(new Set([...opened, ...sections.map(s => marked.sections.indexOf(s))]))
        return (
          <section key={index} className={`lk-section lk-folded${single ? '' : ' lk-folded-run'}`}>
            <h2 title={sections.map(s => s.title).filter(Boolean).join(', ')}>{single ? `§ ${numbered[0].number}. ${numbered[0].title}` : numbered.length ? `§ ${numbered[0].number}–${numbered.at(-1)!.number}` : 'Title and parties'}</h2>
            <button type="button" className="lk-unfold" onClick={unfold}><Icon name="arrow" />{changes ? `${plural(clauses, 'paragraph')} · ${plural(changes, 'settled change')}` : plural(clauses, 'unchanged paragraph')}</button>
          </section>
        )
      })}
    </div>
  )
}
