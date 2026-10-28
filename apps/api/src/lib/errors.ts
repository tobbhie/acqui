import type { Context } from 'hono';

/** Every API failure is `{ error: { code, message } }`. Messages never contain secrets. */
export class ApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
  readonly code: string;
  constructor(status: ApiError['status'], code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'unauthorized', message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const unprocessable = (code: string, message: string) => new ApiError(422, code, message);
export const unavailable = (code: string, message: string) => new ApiError(503, code, message);

export function errorHandler(error: unknown, c: Context) {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  // Never echo internals to the client or into logs with request bodies/headers.
  console.error('unhandled error', error instanceof Error ? error.message : 'unknown');
  return c.json({ error: { code: 'internal_error', message: 'Internal error' } }, 500);
}
