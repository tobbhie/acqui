import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { publicCallbackUrl } from './google';

void describe('Google OAuth callback URL', () => {
  void it('keeps the registered public callback while preserving provider query parameters', () => {
    const callback = publicCallbackUrl(
      'http://localhost:5173/api/auth/google/callback',
      new URL('http://localhost:8080/auth/google/callback?code=abc&state=xyz'),
    );

    assert.equal(
      callback.toString(),
      'http://localhost:5173/api/auth/google/callback?code=abc&state=xyz',
    );
  });
});
