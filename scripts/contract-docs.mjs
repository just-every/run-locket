// Project touched contract rows from the source while preserving legacy records.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const [mode, ...ids] = process.argv.slice(2)
assert.ok(['write', 'check'].includes(mode) && ids.length, 'Usage: node scripts/contract-docs.mjs write|check CLAUSE...')
const source = await readFile('CONTRACT.md', 'utf8')
const rows = source.split('\n').filter(line => /^\| `[A-Z]+-\d+` \|/.test(line)).map(line => {
  const cells = line.slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim())
  assert.equal(cells.length, 6, 'Contract status rows have six cells')
  return { id: cells[0].replaceAll('`', ''), title: cells[1], kind: cells[2], status: cells[3], evidence: cells[4], gap: cells[5], line }
})
assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Each clause has one status row')
const summary = (label, selected) => `| ${label} | ${['done', 'partial', 'missing'].map(status => selected.filter(row => row.status === status).length).join(' | ')} | ${selected.length} |`
const summaries = [summary('Published', rows.filter(row => row.kind === 'published')), summary('Target and push further', rows.filter(row => row.kind !== 'published')), summary('All', rows)]
let contract = source
for (const line of summaries) contract = contract.replace(new RegExp('^\\| ' + line.split(' | ')[0].slice(2) + ' \\|.*$', 'm'), line)
let acceptance = await readFile('ACCEPTANCE.md', 'utf8')
for (const id of ids) {
  const row = rows.find(row => row.id === id)
  assert.ok(row, `Unknown clause ${id}`)
  const start = source.indexOf(`#### ${id} `)
  assert.ok(start >= 0, `Missing target clause ${id}`)
  const next = source.slice(start).search(/\n(?=#### |### |## )/)
  const section = source.slice(start, next < 0 ? undefined : start + next).trim()
  const acceptancePoint = section.match(/\*Acceptance:\* ([\s\S]*?)(?:\n\n|$)/)?.[1]
  assert.ok(acceptancePoint, `Missing acceptance for ${id}`)
  const line = `| \`${id}\` | ${row.title.replaceAll('/', '&#47;')} | ${acceptancePoint.replaceAll('\n', ' ')} | ${row.status} | ${row.evidence}${row.gap ? ' Gap: ' + row.gap.replaceAll('/', '&#47;') : ''} |`
  const pattern = new RegExp('^\\| `' + id + '` \\|.*$', 'm')
  assert.ok(pattern.test(acceptance), `Missing acceptance row ${id}`)
  acceptance = acceptance.replace(pattern, () => line)
  const begin = `<!-- contract-source:${id} -->`, end = `<!-- /contract-source:${id} -->`
  const duties = section.split('\n\n').filter(paragraph => /^(CT policy ruling|Provider doors added|The future Inkwell|Live storage authorization|Live CRM interoperability)/.test(paragraph))
  const status = id === 'EXEC-002' ? section.split('\n\n').find(paragraph => paragraph.startsWith('*Status:*')) : null
  const block = `${begin}\n#### ${id} — Contract source\n\n*Acceptance:* ${acceptancePoint}\n\n${[status, ...duties].filter(Boolean).join('\n\n')}\n${end}`
  const prior = acceptance.indexOf(begin)
  acceptance = prior < 0 ? acceptance.trimEnd() + '\n\n' + block + '\n' : acceptance.slice(0, prior) + block + acceptance.slice(acceptance.indexOf(end, prior) + end.length)
}
const claims = '# Contract status claims\n\nGenerated from CONTRACT.md. These source claims retain every named gap and require their recorded publication gates.\n\n| Clauses | Done | Partial | Missing | Total |\n| --- | ---: | ---: | ---: | ---: |\n' + summaries.join('\n') + '\n\n| Clause | Title | Kind | Status | Evidence | Gap |\n| --- | --- | --- | --- | --- | --- |\n' + rows.map(row => `| \`${row.id}\` | ${row.title.replaceAll('/', '&#47;')} | ${row.kind} | ${row.status} | [Source evidence](CONTRACT.md#status) | ${row.gap.replaceAll('/', '&#47;')} |`).join('\n') + '\n'
for (const [path, content] of [['CONTRACT.md', contract], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
  if (mode === 'write') {
    await mkdir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.', { recursive: true })
    await writeFile(path, content)
  } else assert.equal(await readFile(path, 'utf8'), content, `Stale generated contract document: ${path}`)
}
console.log(`Contract documents ${mode}: ${ids.join(', ')}; ${summaries.at(-1)}`)
