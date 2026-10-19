import { join } from 'node:path'
import { readPrivateFile, writePrivateFile } from '@runeditrun/rer/private-files'

// Optional supplied secrets need an explicit update on an existing installation;
// the shared installer otherwise keeps its earlier private settings unchanged.
export async function saveClickwrapSettings({ root, input, store }) {
  if (input.CLICKWRAP_SIGNING_KEY === undefined) return
  const key = input.CLICKWRAP_SIGNING_KEY
  if (typeof key !== 'string' || /[\r\n\0]/.test(key) || (key && key.length < 32)) throw new Error('The clickwrap signing key must be empty or at least 32 characters on one line.')
  store.addSecrets?.([key])
  const path = join(root, '.dev.vars')
  let content = ''
  try { content = await readPrivateFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const lines = content.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?CLICKWRAP_SIGNING_KEY\s*=/.test(line))
  await writePrivateFile(path, lines.join('\n').replace(/\n*$/, '\n') + `CLICKWRAP_SIGNING_KEY=${JSON.stringify(key)}\n`)
}
