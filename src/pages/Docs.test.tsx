import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { signWebhook } from '../../apps/worker/src/webhooks'
import { Docs } from './Docs'
import * as S from './docs/snippets'

;(globalThis as { window?: unknown }).window = { location: { pathname: '/docs', hash: '', origin: 'https://example.test' } }

const html = renderToString(<QueryClientProvider client={new QueryClient()}><Docs /></QueryClientProvider>).replace(/<!-- -->/g, '')
const text = html.replace(/<[^>]*>/g, ' ')

void describe('docs page', () => {
  void it('has one main heading, a section outline and structured data', () => {
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1)
    assert.ok((html.match(/<h2[ >]/g) ?? []).length >= 8)
    const ld = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)?.[1]
    assert.ok(ld, 'JSON-LD present')
    const graph = (JSON.parse(ld) as { '@graph': { '@type': string }[] })['@graph']
    assert.deepEqual(graph.map((g) => g['@type']), ['TechArticle', 'BreadcrumbList'])
  })

  void it('every in-page link points at a real heading', () => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    assert.ok(links.length > 10)
    for (const link of links) assert.ok(ids.has(link), `missing #${link}`)
  })

  void it('keeps backend jargon out of the prose', () => {
    for (const word of ['CREATE2', 'EIP-712', 'attester', 'scanner', 'advisory lock', 'migration', 'idempotent']) {
      assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `jargon: ${word}`)
    }
  })

  void it('uses the real API address and describes Arc mainnet, with no placeholders or testnet wording', () => {
    assert.ok(text.includes('https://api.51-68-172-236.nip.io'))
    assert.ok(!html.includes('YOUR-SITE') && !text.includes('YOUR-SITE'))
    assert.ok(text.includes('Live on Arc mainnet') && text.includes('chain ID 5042'))
    for (const link of ['https://explorer.arc.io/address/0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418', 'https://explorer.arc.io/address/0x3600000000000000000000000000000000000000']) {
      assert.ok(html.includes(`href="${link}"`), `missing ${link}`)
    }
    assert.ok(!/testnet|test usdc|test mode/i.test(text), 'the docs are written for mainnet')
  })

  void it('images have text alternatives', () => {
    assert.match(html, /role="img"[^>]*aria-labelledby="mock-title mock-desc"/)
    assert.match(html, /<figure[^>]*aria-label=/)
  })
})

void describe('docs code samples are valid and correct', () => {
  void it('JSON samples parse', () => {
    for (const sample of [S.CREATE_RESPONSE, S.WEBHOOK_EVENT, S.LIST_RESPONSE, S.ERROR_SHAPE, S.REFUND_ADDRESS]) JSON.parse(sample)
    const reply = JSON.parse(S.CREATE_RESPONSE) as { livemode: boolean; chain_id: number }
    assert.deepEqual([reply.livemode, reply.chain_id], [true, 5042])
  })

  void it('the request body in the curl and Node samples is the same payload', () => {
    const curlBody = JSON.parse(/-d '([\s\S]*?)'$/.exec(S.CREATE_CURL)?.[1] ?? '{}') as Record<string, string>
    assert.equal(curlBody.currency, 'USDC')
    assert.equal(curlBody.network, 'arc')
    for (const key of Object.keys(curlBody)) assert.ok(S.CREATE_NODE.includes(`${key}:`), `Node sample misses ${key}`)
  })

  void it('shell samples are valid shell', () => {
    for (const sample of [S.ENV_SETUP, S.CREATE_CURL, S.GET_ONE, S.LIST_CURL]) {
      const run = spawnSync('bash', ['-n'], { input: sample, encoding: 'utf8' })
      assert.equal(run.status, 0, run.stderr)
    }
  })

  void it('JavaScript samples are valid syntax', () => {
    const wrap = (code: string) => `(async () => { ${code.replace(/^import .*$/gm, '')} })`
    for (const sample of [S.CREATE_NODE, S.REDIRECT_NODE, S.CONFIRM_RETURN, S.WEBHOOK_NODE]) {
      assert.doesNotThrow(() => new vm.Script(wrap(sample)), sample.slice(0, 40))
    }
  })

  void it('the Node verifier accepts what Acqui signs and rejects tampering and old messages', () => {
    const fn = /function isFromAcqui[\s\S]*?\n}\n/.exec(S.WEBHOOK_NODE)?.[0]
    assert.ok(fn)
    const isFromAcqui = vm.runInNewContext(`${fn}; isFromAcqui`, { createHmac, timingSafeEqual, Buffer, Number, String, Math, Date }) as (
      raw: string, headers: Record<string, string>, secret: string, tolerance?: number) => boolean
    const secret = 'whsec_test_secret'
    const body = S.WEBHOOK_EVENT
    const now = Math.floor(Date.now() / 1000)
    const headers = (t: number, b: string) => ({ 'acqui-timestamp': String(t), 'acqui-signature': signWebhook(secret, t, b) })
    assert.equal(isFromAcqui(body, headers(now, body), secret), true)
    assert.equal(isFromAcqui(body + ' ', headers(now, body), secret), false)
    assert.equal(isFromAcqui(body, headers(now, body), 'other'), false)
    assert.equal(isFromAcqui(body, headers(now - 3600, body), secret), false)
  })

  void it('the Python verifier agrees with the real signature', () => {
    const secret = 'whsec_test_secret'
    const t = Math.floor(Date.now() / 1000)
    const body = S.WEBHOOK_EVENT
    const script = `${S.WEBHOOK_PYTHON}
import json, sys
d = json.load(sys.stdin)
headers = {"Acqui-Timestamp": d["t"], "Acqui-Signature": d["sig"]}
print(is_from_acqui(d["body"].encode(), headers, d["secret"]), is_from_acqui((d["body"] + " ").encode(), headers, d["secret"]))`
    const run = spawnSync('python3', ['-c', script], {
      input: JSON.stringify({ t: String(t), sig: signWebhook(secret, t, body), body, secret }),
      encoding: 'utf8',
    })
    assert.equal(run.stderr, '')
    assert.equal(run.stdout.trim(), 'True False')
  })
})
