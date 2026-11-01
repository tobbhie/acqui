import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiRequestError, setCsrfToken } from '@/lib/api'
import type { PublicConfig, SessionInfo } from '@/lib/types'

export function usePublicConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/public/config'), staleTime: 5 * 60_000, retry: 1 })
}

/** Resolves to null when signed out. Keeps the CSRF token in the API client in sync. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<SessionInfo | null> => {
      try {
        const session = await api<SessionInfo>('/auth/session')
        setCsrfToken(session.csrf_token)
        return session
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          setCsrfToken(null)
          return null
        }
        throw error
      }
    },
    retry: false,
  })
}

/** Ticks once a second so countdowns re-render. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * True once the element has scrolled into view, and stays true. Without IntersectionObserver (old browsers, tests)
 * it is true immediately, so nothing is ever left hidden.
 */
export function useRevealOnce<T extends HTMLElement>(threshold = 0.35): [(node: T | null) => void, boolean] {
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')
  const observer = useRef<IntersectionObserver | null>(null)
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node || typeof IntersectionObserver === 'undefined') return
    observer.current = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown(true)
        observer.current?.disconnect()
      }
    }, { threshold })
    observer.current.observe(node)
  }, [threshold])
  return [ref, shown]
}

export const errorMessage = (error: unknown): string =>
  error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : 'Something went wrong'
