// Locket's look for Base's no-JavaScript documents (sign-in, auth confirmations,
// first-run /setup). Their own hashed style reads the --rer-* theme; the
// engraved card, the centred mark and the pill buttons need rules the theme
// grammar does not carry, so this links one more same-origin stylesheet after
// theirs. The documents and their behaviour are unchanged.
const FRAME = '<link rel="stylesheet" href="/brand/frame.css">'

export async function framedDocument(response: Response | null): Promise<Response | null> {
  if (!response?.headers.get('content-type')?.startsWith('text/html')) return response
  const headers = new Headers(response.headers)
  const policy = headers.get('content-security-policy')
  if (policy) {
    const directives = policy.split(';').map(value => value.trim()).filter(Boolean)
    for (const name of ['style-src', 'img-src']) {
      const index = directives.findIndex(value => value.split(/\s+/)[0] === name)
      if (index < 0) directives.push(`${name} 'self'`)
      else if (!directives[index].split(/\s+/).includes("'self'")) directives[index] += " 'self'"
    }
    headers.set('content-security-policy', directives.join('; '))
  }
  const html = await response.text()
  headers.delete('content-length')
  return new Response(html.replace(/<\/head\s*>/i, `${FRAME}</head>`), { status: response.status, statusText: response.statusText, headers })
}
