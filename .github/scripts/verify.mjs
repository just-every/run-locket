// Partition the existing verification wall without rewriting package.json or
// replacing rer's hosted-output, hydration, or first-party lifecycle checks.
// The internal lifecycle entry is tied to this checkout's locked rer package.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const pipeline = packageJson.scripts['verify:app'].match(/^rer queue verify:app -- sh -c "([^"]+)"$/)?.[1]
assert.ok(pipeline, 'Update CI partitioning for the new verify:app command format')
const ownership = {
  build: 'core', typecheck: 'core',
  'test:runtime': 'core', 'test:email-link': 'core',
  'test:api': 'api', 'test:portable': 'portable',
}
const commands = pipeline.split(/\s*&&\s*/).map(command => {
  const script = command.match(/^pnpm run ([\w:-]+)$/)?.[1]
  assert.ok(script && ownership[script], `Unpartitioned verify:app command: ${command}`)
  return { command, script, phase: ownership[script] }
})
const phase = process.argv[2]
if (phase === '--list') {
  console.log(JSON.stringify(commands, null, 2))
} else {
  assert.equal(process.env.CI, 'true', 'CI verification partitions require CI=true')
  process.env.X_LOCAL_EXPLORER = 'false'
  if (phase === 'core') {
    const [{ resolveProject }, { runCommand }, { parse }, { output }] = await Promise.all([
      import('@runeditrun/rer/internal/cli/project.mjs'),
      import('@runeditrun/rer/internal/cli/lifecycle.mjs'),
      import('@runeditrun/rer/internal/cli/parse.mjs'),
      import('@runeditrun/rer/internal/cli/output.mjs'),
    ])
    const project = await resolveProject(process.cwd())
    // Only this process's target changes. rer still owns setup validation,
    // tools, checkout custody, hosted output, hydration and cleanup in full.
    const adapter = { ...project.adapter, verify: [process.execPath, [fileURLToPath(import.meta.url), 'core-app']] }
    const options = parse(['verify', '--no-queue'])
    const out = output(options)
    out.result(true, 0, await runCommand({ ...project, adapter }, options, out))
  } else if (/^api-[1-4]$/.test(phase)) {
    assert.equal(commands.filter(command => command.phase === 'api').length, 1)
    const command = packageJson.scripts['test:api']
    assert.match(command, /^node --test /, 'Update CI API sharding for the new test runner')
    await run(command.replace(/^node --test /, `node --test --test-shard=${phase.slice(4)}/4 `))
  } else {
    assert.ok(['core-app', 'portable'].includes(phase), `Unknown verification partition: ${phase}`)
    const selected = commands.filter(command => command.phase === (phase === 'core-app' ? 'core' : phase))
    assert.ok(selected.length, `Empty verification partition: ${phase}`)
    for (const { command } of selected) await run(command)
  }
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
