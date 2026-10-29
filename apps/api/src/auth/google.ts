import * as oidc from 'openid-client';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface OAuthFlow {
  state: string;
  codeVerifier: string;
  nonce: string;
}

/** Narrow seam so routes and tests do not depend on the OIDC library directly. */
export interface GoogleAuth {
  createAuthorization(): Promise<{ url: string; flow: OAuthFlow }>;
  /** Validates state, PKCE, nonce, issuer, audience, expiry and the ID token signature. */
  exchange(callbackUrl: URL, flow: OAuthFlow): Promise<GoogleProfile>;
}

const GOOGLE_ISSUER = new URL('https://accounts.google.com');

/** Rebuild the externally registered callback URL after a reverse proxy rewrites its origin/path. */
export function publicCallbackUrl(redirectUri: string, proxiedCallbackUrl: URL): URL {
  const callback = new URL(redirectUri);
  callback.search = proxiedCallbackUrl.search;
  return callback;
}

/** Google OpenID Connect through `openid-client` (certified, maintained). Authorization code flow with PKCE. */
export function createGoogleAuth(opts: { clientId: string; clientSecret: string; redirectUri: string }): GoogleAuth {
  let configPromise: Promise<oidc.Configuration> | undefined;
  const config = () => (configPromise ??= oidc.discovery(GOOGLE_ISSUER, opts.clientId, opts.clientSecret));

  return {
    async createAuthorization() {
      const flow: OAuthFlow = {
        state: oidc.randomState(),
        codeVerifier: oidc.randomPKCECodeVerifier(),
        nonce: oidc.randomNonce(),
      };
      const url = oidc.buildAuthorizationUrl(await config(), {
        redirect_uri: opts.redirectUri,
        scope: 'openid email profile',
        state: flow.state,
        nonce: flow.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(flow.codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url: url.toString(), flow };
    },

    async exchange(callbackUrl, flow) {
      const tokens = await oidc.authorizationCodeGrant(await config(), publicCallbackUrl(opts.redirectUri, callbackUrl), {
        pkceCodeVerifier: flow.codeVerifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
        throw new Error('Google ID token is missing sub or email');
      }
      return {
        sub: claims.sub,
        email: claims.email.toLowerCase(),
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : null,
      };
    },
  };
}
