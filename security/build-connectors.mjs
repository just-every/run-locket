import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const files = path => readdirSync(new URL(path, root), { withFileTypes: true }).flatMap(entry => {
 const name = path + '/' + entry.name
 return entry.isDirectory() ? files(name) : /\.(?:ts|mjs)$/.test(name) ? [name] : []
})
const quoted = text => [...text.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])

// Read provider registries and binding names, never configuration values or credentials.
export function readBuildConnectors() {
 const paths = [...files('src/locket'), 'src/auth.server.ts', 'src/mail.server.mjs', 'src/modules/ai/config.mjs']
 const texts = paths.map(read)
 const bindings = new Set(texts.flatMap(text => [
  ...[...text.matchAll(/(?:\benv|\))\.([A-Z][A-Z0-9_]+)/g)].map(match => match[1]),
  ...[...text.matchAll(/\b([A-Z][A-Z0-9_]+)\?\s*:/g)].map(match => match[1]),
 ]))
 const errors = [], connectors = []
 const capture = (path, expression) => {
  const match = read(path).match(expression)
  if (!match) { errors.push('Cannot read build connector registry: ' + path); return '' }
  return match[1]
 }
 const mail = capture('src/modules/mail/src/sender.mjs', /const transports\s*=\s*\{([^}]+)\}/)
 for (const match of mail.matchAll(/\b([a-z][a-z0-9-]*)\s*:/g)) {
  if (match[1] !== 'development') connectors.push('mail:' + match[1])
 }
 // Postmark is selected directly by the installation wrapper, outside the shared registry.
 if (read('src/mail.server.mjs').includes("=== 'postmark'")) connectors.push('mail:postmark')
 const signing = capture('src/locket/signature-provider.ts', /const names[^=]*=\s*\{([^}]+)\}/)
 for (const match of signing.matchAll(/(?:['"]([a-z][a-z0-9-]*)['"]|\b([a-z][a-z0-9-]*))\s*:\s*['"]([A-Z_]+)['"]/g)) {
  connectors.push('signing:' + (match[1] ?? match[2])); bindings.add(match[3])
 }
 for (const value of quoted(capture('src/locket/renewal-calendar.ts', /oneOf\(p,\s*['"]provider['"],\s*\[([^\]]+)\]/))) connectors.push('calendar:' + value)
 for (const value of quoted(capture('src/locket/approval-channel-config.ts', /approvalChannels\s*=\s*\[([^\]]+)\]/))) {
  if (!['email', 'word', 'phone'].includes(value)) connectors.push('chat:' + value)
 }
 const identity = capture('src/modules/dependencies/protocol.mjs', /export const INTERFACE\s*=\s*['"]([^'"]+)['"]/)
 if (identity) connectors.push('identity:' + identity)
 return { bindings: [...bindings], connectors: [...new Set(connectors)], errors }
}
