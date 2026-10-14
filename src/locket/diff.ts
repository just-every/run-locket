// Line comparison between two version texts: unchanged, removed and added lines.
export type DiffLine = { op: 'same' | 'del' | 'add'; text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n'), b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const head: DiffLine[] = a.slice(0, start).map(text => ({ op: 'same', text }))
  const tail: DiffLine[] = a.slice(endA).map(text => ({ op: 'same', text }))
  const x = a.slice(start, endA), y = b.slice(start, endB)
  if (x.length * y.length > 4_000_000)
    return [...head, ...x.map(text => ({ op: 'del' as const, text })), ...y.map(text => ({ op: 'add' as const, text })), ...tail]
  // Longest common subsequence table, filled from the end.
  const w = y.length + 1
  const table = new Uint32Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i * w + j] = x[i] === y[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1])
  const middle: DiffLine[] = []
  let i = 0, j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { middle.push({ op: 'same', text: x[i] }); i++; j++ }
    else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) middle.push({ op: 'del', text: x[i++] })
    else middle.push({ op: 'add', text: y[j++] })
  }
  while (i < x.length) middle.push({ op: 'del', text: x[i++] })
  while (j < y.length) middle.push({ op: 'add', text: y[j++] })
  return [...head, ...middle, ...tail]
}
