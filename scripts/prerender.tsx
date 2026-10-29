/**
 * Runs after `vite build`. Writes real HTML for the docs page (so search engines and link previews
 * see the content without running JavaScript) plus robots.txt and, when SITE_URL is set, sitemap.xml.
 * The browser app still loads on top of it as usual.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const DIST = 'dist'
const site = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? '').replace(/\/+$/, '')

// The app reads window while rendering; give it a minimal one.
;(globalThis as { window?: unknown }).window = {
  location: { pathname: '/docs', hash: '', hostname: site ? new URL(site).hostname : 'localhost', origin: site },
}

const { default: App } = await import('../src/App')
const { DOCS_DESCRIPTION, DOCS_TITLE } = await import('../src/pages/Docs')

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const body = renderToString(
  <QueryClientProvider client={new QueryClient()}>
    <App />
  </QueryClientProvider>,
)

const url = site ? `${site}/docs` : ''
const head = [
  `<title>${escapeAttr(DOCS_TITLE)}</title>`,
  `<meta name="description" content="${escapeAttr(DOCS_DESCRIPTION)}" />`,
  `<meta name="robots" content="index, follow" />`,
  url && `<link rel="canonical" href="${url}" />`,
  `<meta property="og:title" content="${escapeAttr(DOCS_TITLE)}" />`,
  `<meta property="og:description" content="${escapeAttr(DOCS_DESCRIPTION)}" />`,
  url && `<meta property="og:url" content="${url}" />`,
  `<meta name="twitter:title" content="${escapeAttr(DOCS_TITLE)}" />`,
  `<meta name="twitter:description" content="${escapeAttr(DOCS_DESCRIPTION)}" />`,
]
  .filter(Boolean)
  .join('\n    ')

let html = readFileSync(`${DIST}/index.html`, 'utf8')
html = html
  .replace(/<title>[\s\S]*?<\/title>\s*/, '')
  .replace(/<meta (?:name|property)="(?:description|og:title|og:description|twitter:card)"[^>]*>\s*/g, '')
  .replace('</head>', `    ${head}\n    <meta name="twitter:card" content="summary" />\n  </head>`)
  .replace('<div id="root"></div>', `<div id="root">${body}</div>`)

mkdirSync(`${DIST}/docs`, { recursive: true })
writeFileSync(`${DIST}/docs/index.html`, html)

const robots = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /pay/',
  'Disallow: /dashboard',
  'Disallow: /demo/order/',
  'Disallow: /api/',
  site && `Sitemap: ${site}/sitemap.xml`,
]
  .filter(Boolean)
  .join('\n')
writeFileSync(`${DIST}/robots.txt`, `${robots}\n`)

if (site) {
  const today = new Date().toISOString().slice(0, 10)
  const urls = ['/', '/demo', '/docs']
    .map((path) => `  <url><loc>${site}${path === '/' ? '/' : path}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n')
  writeFileSync(`${DIST}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
}

console.log(`prerendered /docs (${body.length} chars of HTML)${site ? ` for ${site}` : ' without a site URL (no canonical or sitemap)'}`)
