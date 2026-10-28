// Compatibility entry for former touched-clause callers. The shared source now
// regenerates and checks every clause together; no legacy output is edited here.
import { spawnSync } from 'node:child_process'
import { parseContract } from '../src/base/seed-contract.mjs'
import { readFileSync } from 'node:fs'
const [mode, ...ids] = process.argv.slice(2)
if (!['write', 'check'].includes(mode)) throw new Error('Usage: contract-docs.mjs write|check [CLAUSE...]')
const known = new Set(parseContract(readFileSync('CONTRACT.md', 'utf8')).clauses.map(clause => clause.id))
for (const id of ids) if (!known.has(id)) throw new Error(`Unknown clause ${id}`)
const result = spawnSync(process.execPath, ['src/base/contract-docs.mjs', mode], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
