import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type {
  AssistantBlock, ConversationSnapshot, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { MarkdownText, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SideChatPanelProps } from './slots.ts'
import css from './SideChatPanel.module.css'

interface TranscriptRow {
  key: string
  role: 'user' | 'assistant'
  text: string
}

function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n')
}

function userText(node: UserMessageNode): string {
  return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')
}

function transcript(snapshot: ConversationSnapshot | null): TranscriptRow[] {
  if (snapshot === null) return []
  const rows: TranscriptRow[] = []
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key) as ChatNode | undefined
    if (node?.kind === 'user') {
      rows.push({ key, role: 'user', text: userText(node.data) })
    } else if (node?.kind === 'assistant-step') {
      const text = assistantText(node.data.blocks)
      if (text !== '') rows.push({ key, role: 'assistant', text })
    }
  }
  return rows
}

/** Compact child transcript and composer hosted in the details column. */
export function SideChatPanel({ useSideChat, send, close, t }: SideChatPanelProps) {
  const view = useSideChat(value => value)
  const rows = useMemo(() => transcript(view.conversation), [view.conversation])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [rows.length])

  const submit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === '' || pending) return
    setPending(true)
    const result = await send(value)
    setPending(false)
    if (result.ok) setDraft('')
  }
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void submit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <div className={css.root} data-side-chat-panel>
      <header className={css.header}>
        <strong>{t('panel.title')}</strong>
        <button type="button" className={css.close} aria-label={t('panel.close')} onClick={close}>×</button>
      </header>
      {view.origin !== null && view.origin.text !== '' && (
        <aside className={css.quote}>
          <span>{t('panel.quote')}</span>
          <p>{view.origin.text}</p>
        </aside>
      )}
      <div className={css.transcript} aria-live="polite">
        {view.phase === 'forking' && <p className={css.state}>{t('panel.creating')}</p>}
        {rows.length === 0 && view.phase !== 'forking' && <p className={css.state}>{t('panel.empty')}</p>}
        {rows.map(row => (
          <article key={row.key} className={css.message} data-role={row.role}>
            {row.role === 'assistant' ? <MarkdownText text={row.text} /> : <MessageText text={row.text} />}
          </article>
        ))}
        {view.error !== null && <p className={css.error}>{t('panel.error')}: {view.error}</p>}
        <div ref={endRef} />
      </div>
      <form className={css.composer} onSubmit={onSubmit}>
        <textarea
          value={draft}
          rows={3}
          placeholder={t('composer.placeholder')}
          disabled={pending}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={pending || draft.trim() === ''}>{t('composer.send')}</button>
      </form>
    </div>
  )
}
