// Keep Locket's existing verification partitions under Base's shared lifecycle.
// Base's verify-ci owns the full hosted lifecycle; this runner retains Locket's partitions.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const commands = [
  ...['build', 'typecheck', 'test:runtime', 'test:email-link'].map(script => ({ command: `pnpm run ${script}`, script, phase: 'core' })),
  { command: 'pnpm run test:api', script: 'test:api', phase: 'api' },
  { command: 'pnpm run test:portable', script: 'test:portable', phase: 'portable' },
]
const phase = process.argv[2]
if (phase === '--list') {
  console.log(JSON.stringify(commands, null, 2))
} else if (phase === '--list-api') {
  console.log(JSON.stringify(await apiPartitions(), null, 2))
} else {
  process.env.X_LOCAL_EXPLORER = 'false'
  if (/^api-(?:[1-4]|flows)$/.test(phase)) {
    assert.equal(commands.filter(command => command.phase === 'api').length, 1)
    const command = packageJson.scripts['test:api']
    assert.match(command, /^node --test /, 'Update CI API sharding for the new test runner')
    const glob = 'tests/api/*.test.mjs', selected = (await apiPartitions())[phase]
    assert.ok(selected.length, `Empty API verification partition: ${phase}`)
    assert.equal(command.split(glob).length, 2, 'Update CI API partitioning for the new test-file selection')
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
    await run(command.replace(glob, selected.map(quote).join(' ')))
  } else {
    assert.ok(['core-app', 'portable'].includes(phase), `Unknown verification partition: ${phase}`)
    const selected = commands.filter(command => command.phase === (phase === 'core-app' ? 'core' : phase))
    assert.ok(selected.length, `Empty verification partition: ${phase}`)
    for (const { command } of selected) await run(command)
  }
}

async function apiPartitions() {
  const partitions = { 'api-1': [], 'api-2': [], 'api-3': [], 'api-4': [], 'api-flows': [] }
  const files = (await readdir('./tests/api', { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs')).map(entry => entry.name).sort()
  for (const [index, file] of files.entries()) {
    const partition = file === 'flows.test.mjs' ? 'api-flows' : `api-${index % 4 + 1}`
    partitions[partition].push('./tests/api/' + file)
  }
  return partitions
}

async function run(command) {
  console.log(`CI verification: ${command}`)
  const child = spawn('sh', ['-c', command], { stdio: 'inherit', env: process.env })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => signal ? reject(new Error(`${command} terminated by ${signal}`)) : resolve(code))
  })
  assert.equal(code, 0, `${command} failed with exit ${code}`)
}
