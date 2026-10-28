import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'

/** Minimal path router: no hash routes, so every page can be loaded directly. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    window.addEventListener('acqui:navigate', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('acqui:navigate', onChange)
    }
  }, [])
  return path
}

export function navigate(to: string): void {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event('acqui:navigate'))
  window.scrollTo({ top: 0 })
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.button !== 0) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handle} {...rest} />
}
