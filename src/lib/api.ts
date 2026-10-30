/**
 * Browser API client. It only ever talks to this app's own origin (/api is proxied to the Acqui API),
 * authenticates with the HttpOnly session cookie and sends the CSRF token on writes.
 * There is deliberately no way to attach a merchant API key here: customer payments are created by a merchant's server.
 */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

let csrfToken: string | null = null
export const setCsrfToken = (token: string | null): void => {
  csrfToken = token
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

function isErrorEnvelope(value: unknown): value is { error: { code?: unknown; message?: unknown } } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value).error === 'object'
}

export async function api<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError(0, 'network_error', 'Could not reach the Acqui API. Check your connection and try again.')
  }
  if (res.status === 204) return undefined as T
  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const e = isErrorEnvelope(json) ? json.error : null
    throw new ApiRequestError(
      res.status,
      typeof e?.code === 'string' ? e.code : 'unknown_error',
      typeof e?.message === 'string' ? e.message : `Request failed (${res.status})`,
    )
  }
  return json as T
}

export const googleLoginUrl = `${BASE}/auth/google/start`
