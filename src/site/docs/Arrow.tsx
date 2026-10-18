/** The docs' small arrows for links forward and back. */
export function Arrow({ back = false }: { back?: boolean }) {
  return <svg className="docs-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d={back ? 'M16 10H4M9 5 4 10l5 5' : 'M4 10h12M11 5l5 5-5 5'} /></svg>
}
