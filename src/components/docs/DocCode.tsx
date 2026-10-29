import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

export type CodeLang = 'bash' | 'js' | 'json' | 'python' | 'http'

/** Tiny highlighter: comments, strings, numbers and keywords. Good enough to read, nothing to maintain. */
function highlight(lang: CodeLang, code: string): ReactNode[] {
  const keywords = lang === 'js'
    ? /\b(const|let|await|async|return|import|from|export|function|if|else|new|true|false|null)\b/
    : lang === 'python'
      ? /\b(import|from|def|return|if|else|True|False|None|and|not|in)\b/
      : lang === 'json'
        ? /\b(true|false|null)\b/
        : /\b(curl|export|echo)\b/
  const comment = lang === 'js' ? /\/\/.*/ : /#.*/
  const parts: string[] = [comment.source, '"(?:[^"\\\\]|\\\\.)*"', "'(?:[^'\\\\]|\\\\.)*'", '`(?:[^`\\\\]|\\\\.)*`', '\\b\\d+(?:\\.\\d+)?\\b', keywords.source]
  const pattern = new RegExp(`(${parts.join('|')})`, 'g')
  const out: ReactNode[] = []
  let last = 0
  for (const match of code.matchAll(pattern)) {
    const text = match[0]
    const at = match.index
    if (at > last) out.push(code.slice(last, at))
    let cls = 'text-[#9fd3ff]'
    if (comment.test(text) && (text.startsWith('#') || text.startsWith('//'))) cls = 'text-[#8c9bb0] italic'
    else if (/^["'`]/.test(text)) {
      const isKey = lang === 'json' && code.slice(at + text.length).trimStart().startsWith(':')
      cls = isKey ? 'text-[#ffd9a0]' : 'text-[#a8e6b0]'
    } else if (/^\d/.test(text)) cls = 'text-[#f4b3c2]'
    else cls = 'text-[#c9b6ff]'
    out.push(<span key={`${at}-${text.length}`} className={cls}>{text}</span>)
    last = at + text.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

const LABEL: Record<CodeLang, string> = { bash: 'Terminal', js: 'JavaScript', json: 'JSON', python: 'Python', http: 'HTTP' }

export function DocCode({ lang, code, title }: { lang: CodeLang; code: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <figure className="my-5 overflow-hidden rounded-2xl border border-[rgba(18,45,69,0.25)] bg-[#0f2338] text-[#e8eef6] shadow-[0_8px_30px_rgba(18,45,69,0.12)]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-xs text-[#a9b8cb]">
        <span>{title ?? LABEL[lang]}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[#d6e2f0] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
          aria-label={`Copy ${title ?? LABEL[lang]} code`}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre className="mono overflow-x-auto p-4 text-[13px] leading-6" tabIndex={0}>
        <code>{highlight(lang, code)}</code>
      </pre>
    </figure>
  )
}
