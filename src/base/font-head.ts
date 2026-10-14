// Shared by the root renderer and the no-JavaScript first-run document.
// Edition owners can replace these self-hosted URLs with their brand assets.
export const fontLinks = [
  { rel: 'preload', href: '/fonts/libre-franklin/libre-franklin-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: '/fonts/brygada1918/brygada1918-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: '/fonts/fonts.css' },
] as const

export const fontHead = fontLinks.map(link => `<link ${Object.entries(link).map(([name, value]) => `${name.toLowerCase()}="${value}"`).join(' ')}>`).join('')
