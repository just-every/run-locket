import { join } from 'node:path'
import { readPrivateFile, writePrivateFile } from '@runeditrun/rer/private-files'

// Optional supplied secrets need an explicit update on an existing installation;
// the shared installer otherwise keeps its earlier private settings unchanged.
export async function saveProductSecrets({ root, input, store }) {
  for (const name of ['CLICKWRAP_SIGNING_KEY', 'NOTICE_RESEND_WEBHOOK_SECRET']) {
    if (input[name] === undefined) continue
    const key = input[name]
    if (typeof key !== 'string' || /[\r\n\0]/.test(key) || (key && (name === 'CLICKWRAP_SIGNING_KEY' ? key.length < 32 : !/^whsec_[A-Za-z0-9+/]{22,128}={0,2}$/.test(key)))) throw new Error(`The ${name} must be empty or a valid one-line signing key.`)
    store.addSecrets?.([key])
    const path = join(root, '.dev.vars')
    let content = ''
    try { content = await readPrivateFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const assignment = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`)
    const lines = content.split(/\r?\n/).filter(line => !assignment.test(line))
    await writePrivateFile(path, lines.join('\n').replace(/\n*$/, '\n') + `${name}=${JSON.stringify(key)}\n`)
  }
}
