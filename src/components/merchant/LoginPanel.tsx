import { Card } from '@/components/Shell'
import { Alert, LinkButton } from '@/components/ui'
import { googleLoginUrl } from '@/lib/api'

export function LoginPanel({ error, confirming = false }: { error: string | null; confirming?: boolean }) {
  return (
    <div className="mx-auto max-w-md pt-8">
      <Card>
        <h1 className="display text-3xl font-bold">Merchant dashboard</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          Sign in with Google to set up your payout address, create API keys and see your payments.
        </p>
        {confirming && (
          <div className="mt-4">
            <Alert tone="info" title="Sign in to confirm">Sign in with the Google account that requested the change, then open the link in your email again.</Alert>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Alert tone="danger" title="Sign-in failed">
              {error === 'email_unverified'
                ? 'Google did not confirm a verified email. Try again with another account.'
                : 'Google sign-in could not be completed. Please try again.'}
            </Alert>
          </div>
        )}
        <div className="mt-6">
          <LinkButton href={googleLoginUrl} className="w-full">Continue with Google</LinkButton>
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">We only read your verified Google email and name. Acqui never gets access to your Google data.</p>
      </Card>
    </div>
  )
}
