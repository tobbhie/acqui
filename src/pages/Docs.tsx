import { useSyncExternalStore } from 'react'
import { siteOrigin, usePageMeta } from '@/lib/meta'
import { Link } from '@/lib/route'
import { H2, H3, Ic, P, Step, Steps, Table } from '@/components/docs/Doc'
import { DocCode } from '@/components/docs/DocCode'
import { Callout, CheckoutMock, FeeSplit, FlowDiagram, StatusTrack } from '@/components/docs/Diagrams'
import * as S from '@/pages/docs/snippets'

export const DOCS_TITLE = 'Acqui docs: accept USDC payments on Arc with one API'
export const DOCS_DESCRIPTION =
  'Add USDC payments to your site in minutes. Create a checkout from your server, send customers to a hosted page, and get a signed message when you are paid.'

const SECTIONS = [
  { id: 'overview', label: 'How it works' },
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'payment-status', label: 'Know when you are paid' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'look-up-payments', label: 'Look up payments' },
  { id: 'fees-and-limits', label: 'Fees and limits' },
  { id: 'late-and-partial', label: 'Late and partial payments' },
  { id: 'errors', label: 'Errors' },
  { id: 'go-live', label: 'Go-live checklist' },
] as const

/** Shown after the page loads, so the text always matches the site you are reading. */
function YourAddress() {
  // Empty on the server-rendered page, the real address once the page runs in the browser.
  const url = useSyncExternalStore(
    () => () => undefined,
    () => `${window.location.origin}/api`,
    () => null,
  )
  if (!url) return null
  return (
    <Callout title="Your Acqui address">
      <p>On this site, use <Ic>{url}</Ic> wherever the examples say <Ic>https://YOUR-SITE/api</Ic>.</p>
    </Callout>
  )
}

/** Structured data so search engines understand this is a technical article with a breadcrumb trail. */
function JsonLd() {
  const origin = siteOrigin()
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: 'Accept USDC payments with the Acqui API',
        description: DOCS_DESCRIPTION,
        url: `${origin}/docs`,
        inLanguage: 'en',
        proficiencyLevel: 'Beginner',
        about: ['USDC payments', 'Payment API', 'Webhooks'],
        publisher: { '@type': 'Organization', name: 'Acqui' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Acqui', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: 'Docs', item: `${origin}/docs` },
        ],
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}

export function Docs() {
  usePageMeta({ title: DOCS_TITLE, description: DOCS_DESCRIPTION, path: '/docs' })

  return (
    <div className="grid gap-10 pb-16 pt-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="On this page" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
          <details open>
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-[var(--muted)] lg:cursor-default">On this page</summary>
            <ul className="mt-3 space-y-1 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-[var(--ink-2)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]">{s.label}</a>
                </li>
              ))}
            </ul>
          </details>
        </nav>
      </aside>

      <article className="min-w-0">
        <JsonLd />
        <header>
          <p className="mono text-xs text-[var(--muted)]">Developer docs</p>
          <h1 className="display mt-2 text-4xl font-bold leading-tight text-[var(--ink)] sm:text-5xl">Accept USDC payments with the Acqui API</h1>
          <p className="mt-4 max-w-[62ch] text-lg leading-8 text-[var(--ink-2)]">
            Your server creates a payment. Your customer pays on a hosted checkout page. You get USDC in your own wallet and a signed message telling you the order is paid.
          </p>
          <Callout title="Test mode">
            <p>While the footer of this site says <strong>Arc Testnet</strong>, every payment uses free test USDC. Build and try everything first. Test payments have <Ic>"livemode": false</Ic>.</p>
          </Callout>
        </header>

        <H2 id="overview">How it works</H2>
        <P>You make one request from your server. Acqui gives you a checkout link. The customer pays, and Acqui tells your server when the money has arrived.</P>
        <FlowDiagram />
        <P>You need three things: a merchant account (sign in with Google), a wallet address to receive payments, and an API key. The key stays on your server and is never put in a web page or mobile app.</P>

        <H2 id="quickstart">Quickstart</H2>
        <Steps>
          <Step title="Set up your store">
            Open <Link to="/merchants" className="font-medium text-[var(--accent-hover)] underline">Merchants</Link>, sign in, and enter your store name, the wallet address that receives payments, and your website address (for example <Ic>https://shop.example.com</Ic>, with no path). Customers can only be sent back to that website.
          </Step>
          <Step title="Create an API key">
            Go to the <strong>Integration</strong> tab and create a key. It looks like <Ic>aq_live_…</Ic> and is shown <strong>once</strong>. Save it in your server settings.
          </Step>
          <Step title="Create a payment from your server">
            Send the request below. Each order needs its own <Ic>Idempotency-Key</Ic>, a value you choose. If a request fails and you send it again with the same key, you get the same payment back instead of a second one.
          </Step>
          <Step title="Send the customer to checkout">
            Redirect them to the <Ic>checkout_url</Ic> from the reply. That is the whole integration on the customer side.
          </Step>
        </Steps>
        <YourAddress />
        <DocCode lang="bash" title="Terminal: set your values" code={S.ENV_SETUP} />
        <H3 id="create-payment">Create a payment</H3>
        <DocCode lang="bash" title="Terminal" code={S.CREATE_CURL} />
        <DocCode lang="js" title="Node.js" code={S.CREATE_NODE} />
        <P>The reply is your payment. Keep <Ic>payment_id</Ic> with your order, then send the customer to <Ic>checkout_url</Ic>.</P>
        <DocCode lang="json" title="Reply" code={S.CREATE_RESPONSE} />
        <Table
          caption="Fields in the create-payment request"
          head={['Field', 'Required', 'What it is']}
          rows={[
            [<Ic key="a">amount</Ic>, 'Yes', 'The price as text, for example "10.00". At least "1.00", up to 6 decimals.'],
            [<Ic key="c">currency</Ic>, 'Yes', 'Always "USDC".'],
            [<Ic key="n">network</Ic>, 'Yes', 'Always "arc".'],
            [<Ic key="o">order_id</Ic>, 'Yes', 'Your own order number. It comes back in every reply and message.'],
            [<Ic key="d">description</Ic>, 'No', 'Shown to the customer on the checkout page.'],
            [<Ic key="s">success_url</Ic>, 'No', 'Where the “Return to store” button goes after payment. Must be on your website address.'],
            [<Ic key="x">cancel_url</Ic>, 'No', 'Where the button goes if the payment window closes. Same rule.'],
            [<Ic key="r">refund_address</Ic>, 'No', 'A customer wallet to return money to if something goes wrong. Defaults to your payout wallet.'],
          ]}
        />
        <H3 id="redirect">Send the customer to checkout</H3>
        <DocCode lang="js" title="Node.js (Express)" code={S.REDIRECT_NODE} />
        <P>Each payment has its own payment address and a 30 minute window. If the window closes, create a <strong>new</strong> payment with a new <Ic>Idempotency-Key</Ic>. Never reuse an old address.</P>
        <CheckoutMock />
        <Callout tone="warn" title="The redirect is not proof of payment">
          <p>A customer can open your thank-you page without paying. Mark an order paid only when you receive the <Ic>payment.settled</Ic> message, or when the payment you look up says <Ic>"status": "settled"</Ic>.</p>
        </Callout>
        <DocCode lang="js" title="Node.js: confirm on your thank-you page" code={S.CONFIRM_RETURN} />

        <H2 id="payment-status">Know when you are paid</H2>
        <P>Every payment has a <Ic>status</Ic>. It moves forward on its own; you never update it.</P>
        <StatusTrack />
        <Table
          caption="Payment statuses and what to do"
          head={['Status', 'What it means', 'What you do']}
          rows={[
            [<Ic key="1">awaiting_payment</Ic>, 'Checkout is open. Nothing has arrived yet.', 'Wait.'],
            [<Ic key="2">deposit_detected</Ic>, 'A payment was seen and is being checked.', 'Wait.'],
            [<><Ic key="3">verifying</Ic> / <Ic key="4">settling</Ic></>, 'Confirmed and being paid out to you.', 'Wait. This usually takes a moment.'],
            [<Ic key="5">settled</Ic>, 'You have been paid.', <strong key="6">Fulfil the order.</strong>],
            [<Ic key="7">expired</Ic>, 'The 30 minutes passed and nothing arrived.', 'Offer a new payment.'],
            [<Ic key="8">underpaid</Ic>, 'Less than the full amount arrived in time.', 'Do not fulfil. The money is returned (see below).'],
            [<Ic key="9">recovery_required</Ic>, 'Money arrived late or outside the rules.', 'Do not fulfil. The money is returned.'],
            [<Ic key="10">retryable_failure</Ic>, 'A temporary problem. Acqui retries by itself.', 'Wait.'],
          ]}
        />

        <H2 id="webhooks">Webhooks</H2>
        <P>A webhook is a message Acqui sends to your server. Add its address (it must be a public <Ic>https://</Ic> address) in <strong>Merchants → Integration</strong>, then create a signing secret. The secret is shown once; keep it on your server.</P>
        <DocCode lang="json" title="Message: payment.settled" code={S.WEBHOOK_EVENT} />
        <P>Every message carries these headers:</P>
        <Table
          caption="Headers on every webhook message"
          head={['Header', 'Use']}
          rows={[
            [<Ic key="a">Acqui-Signature</Ic>, 'Proves the message is from Acqui. Check it before you trust anything inside.'],
            [<Ic key="b">Acqui-Timestamp</Ic>, 'When this attempt was sent. Reject messages older than 5 minutes.'],
            [<Ic key="c">Acqui-Delivery-Id</Ic>, 'The same on every retry of one message. Use it so you never fulfil an order twice.'],
            [<Ic key="d">Acqui-Event</Ic>, '"payment.settled" or "payment.expired".'],
          ]}
        />
        <H3 id="verify">Check the signature</H3>
        <P>Use the raw text of the request, exactly as it arrived. If you parse it first and write it back out, the check fails.</P>
        <DocCode lang="js" title="Node.js (Express)" code={S.WEBHOOK_NODE} />
        <DocCode lang="python" title="Python" code={S.WEBHOOK_PYTHON} />
        <P>Answer with any <Ic>2xx</Ic> status within 10 seconds, and do slow work afterwards. If you answer with anything else, or do not answer, Acqui tries again: after 30 seconds, then 1, 2, 5, 10 and 30 minutes, then 1, 2, 4, 8 and 12 hours. Redirects are not followed, so answer from the exact address you registered.</P>
        <Callout title="Only one message means “fulfil the order”">
          <p><Ic>payment.settled</Ic> is the one. <Ic>payment.expired</Ic> is for your information, for example to clear a cart.</p>
        </Callout>

        <H2 id="look-up-payments">Look up payments</H2>
        <P>Read one payment by its <Ic>payment_id</Ic>:</P>
        <DocCode lang="bash" title="Terminal" code={S.GET_ONE} />
        <P>List your payments, newest first. Use <Ic>limit</Ic> (up to 100) and <Ic>status</Ic> to filter. If <Ic>next_cursor</Ic> is not empty, pass it back as <Ic>cursor</Ic> to get the next page.</P>
        <DocCode lang="bash" title="Terminal" code={S.LIST_CURL} />
        <DocCode lang="json" title="Reply" code={S.LIST_RESPONSE} />
        <P>You only ever see your own payments. Asking for someone else’s returns “not found”.</P>

        <H2 id="fees-and-limits">Fees and limits</H2>
        <FeeSplit />
        <Table
          caption="Fees and limits"
          head={['', 'Detail']}
          rows={[
            ['Acqui fee', 'The larger of 0.10 USDC or 0.1% of the amount, rounded up.'],
            ['Network fee', 'A small fixed amount per payment that covers the cost of paying you. It is shown in the reply as keeper_reimbursement.'],
            ['You receive', 'The amount minus both fees. It is in the reply as merchant_net, and the fees are fixed when the payment is created.'],
            ['Smallest payment', '1.00 USDC.'],
            ['Payment window', '30 minutes from creation.'],
            ['Money and network', 'USDC on Arc only.'],
          ]}
        />

        <H2 id="late-and-partial">Late and partial payments</H2>
        <P>Customers sometimes pay too little, too late, or too much. Acqui never fulfils those orders for you and never keeps the money.</P>
        <Table
          caption="What happens to unusual payments"
          head={['What happened', 'Result']}
          rows={[
            ['Paid after the 30 minutes', 'Not accepted. The money is returned after a waiting period of up to 24 hours.'],
            ['Paid less than the amount', 'Not accepted. The money is returned after the same waiting period.'],
            ['Paid more than the amount', 'The order is paid. The extra is returned right after.'],
          ]}
        />
        <P>Returned money goes to the payment’s refund wallet. By default that is <strong>your payout wallet</strong>, so you pay the customer back yourself. To send it straight to a customer wallet, add <Ic>refund_address</Ic> when you create the payment:</P>
        <DocCode lang="json" title="Request body" code={S.REFUND_ADDRESS} />

        <H2 id="errors">Errors</H2>
        <P>When a request fails you get a normal HTTP error status and a body like this:</P>
        <DocCode lang="json" title="Error reply" code={S.ERROR_SHAPE} />
        <Table
          caption="Common error codes"
          head={['Status', 'Code', 'What to do']}
          rows={[
            ['401', <Ic key="a">unauthorized</Ic>, 'Check the API key. It may have been revoked.'],
            ['400', <Ic key="b">idempotency_key_required</Ic>, 'Add an Idempotency-Key header.'],
            ['422', <Ic key="c">invalid_request</Ic>, 'A field is wrong. The message names it, for example amount.'],
            ['422', <Ic key="d">idempotency_key_reused</Ic>, 'That key was used for a different order. Use a new key.'],
            ['422', <Ic key="e">return_origin_not_allowed</Ic>, 'success_url or cancel_url is not on your website address. Fix it in Settings.'],
            ['422', <Ic key="f">address_blocklisted</Ic>, 'The USDC issuer has blocked a wallet on this payment. Use another wallet.'],
            ['409', <Ic key="g">payout_not_configured</Ic>, 'Add your payout wallet in the dashboard first.'],
            ['429', <Ic key="h">rate_limited</Ic>, 'Too many requests. Wait a few seconds and try again.'],
            ['503', <Ic key="i">contracts_not_configured</Ic>, 'Payments are not available right now. Try again shortly.'],
          ]}
        />

        <H2 id="go-live">Go-live checklist</H2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-[15px] leading-7 text-[var(--ink-2)]">
          <li>Your API key is only in server settings, never in a web page, app, or code repository.</li>
          <li>Each order has its own <Ic>Idempotency-Key</Ic>, and a new payment is created after the window closes.</li>
          <li>You fulfil orders only on <Ic>payment.settled</Ic>, after checking the signature.</li>
          <li>Your webhook answers fast with <Ic>2xx</Ic> and ignores a delivery id it has already handled.</li>
          <li>You have run a full test with test USDC, including a payment left to expire.</li>
          <li>Your payout wallet address is correct. A change needs a confirmation from your email.</li>
        </ul>
        <P>Want to see it working first? Try the <Link to="/demo" className="font-medium text-[var(--accent-hover)] underline">demo store</Link>, then <Link to="/merchants" className="font-medium text-[var(--accent-hover)] underline">set up your own</Link>.</P>
      </article>
    </div>
  )
}
