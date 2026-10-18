// Dates, times and amounts on the run site never break inside: this binds the spaces inside them with no-break
// spaces in the rendered HTML's text (never inside tags or attributes), after React has written it.
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
const rules: [RegExp, string][] = [
  [new RegExp(`\\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ${MONTH} (\\d{1,2})\\b`, 'g'), '$1 $2 $3'],
  [new RegExp(`\\b${MONTH} (\\d{1,2})\\b`, 'g'), '$1 $2'],
  [/\b(\d{1,2}), (20\d\d)\b/g, '$1, $2'],
  [/\b(\d{1,2}:\d{2}) (am|pm)\b/g, '$1 $2'],
  [/\b(am|pm) (CT|ET)\b/g, '$1 $2'],
]

// A start command wraps only before the repository name: each half is one unbreakable piece.
const commands: [RegExp, string][] = [
  [/(npx -y @runeditrun\/rer (?:dev|setup))(?= )/g, '<span class="nw">$1</span>'],
  [/\b(just-every\/run-locket)\b/g, '<span class="nw">$1</span>'],
]

export function bindTokens(html: string): string {
  return html.split(/(<[^>]*>)/).map(part => part.startsWith('<') ? part : [...rules, ...commands].reduce((text, [pattern, to]) => text.replace(pattern, to), part)).join('')
}
