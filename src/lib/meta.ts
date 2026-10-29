import { useEffect } from 'react'

/** Public address of the site. Set VITE_SITE_URL at build time for share links; otherwise the current origin. */
export function siteOrigin(): string {
  const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '')
  return configured || window.location.origin
}

export interface PageMeta {
  title: string
  description: string
  /** Absolute origin used for canonical and share URLs. Defaults to the current origin. */
  origin?: string
  path?: string
  /** Keeps private or per-customer pages (checkout, dashboard) out of search results. */
  noindex?: boolean
}

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/** Writes title, description, canonical, share tags and robots into <head>. */
export function applyMeta(meta: PageMeta): void {
  const origin = meta.origin ?? siteOrigin()
  const url = `${origin}${meta.path ?? window.location.pathname}`
  document.title = meta.title
  setMeta('name', 'description', meta.description)
  setMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : 'index, follow')
  setMeta('property', 'og:title', meta.title)
  setMeta('property', 'og:description', meta.description)
  setMeta('property', 'og:type', 'website')
  setMeta('property', 'og:site_name', 'Acqui')
  setMeta('name', 'twitter:card', 'summary')
  setMeta('name', 'twitter:title', meta.title)
  setMeta('name', 'twitter:description', meta.description)
  if (!meta.noindex) {
    setCanonical(url)
    setMeta('property', 'og:url', url)
  }
}

export function usePageMeta(meta: PageMeta): void {
  const { title, description, origin, path, noindex } = meta
  useEffect(() => {
    applyMeta({ title, description, origin, path, noindex })
  }, [title, description, origin, path, noindex])
}
