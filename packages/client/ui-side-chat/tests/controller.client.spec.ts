import { describe, expect, it, vi } from 'vitest'
import type {
  ConversationSnapshot, ISessions, SessionFace, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { SideChatController } from '../src/client/controller.ts'

const sid = (value: string): SessionId => value as SessionId

function bench() {
  const conversation = { marker: 'child' } as unknown as ConversationSnapshot
  let listener: (() => void) | null = null
  const off = vi.fn()
  const prompt = vi.fn<SessionFace['prompt']>().mockResolvedValue({ ok: true, value: { accepted: true } })
  const child = {
    sessionId: sid('child'),
    getSnapshot: () => conversation,
    subscribe: (next: () => void) => { listener = next; return off },
    prompt,
    readAttachment: vi.fn(),
    updateQueue: vi.fn(),
    cancel: vi.fn(),
    rename: vi.fn(),
    loadOlder: vi.fn(),
    command: vi.fn(),
    projections: { faceOf: vi.fn() },
  } as unknown as SessionFace
  const fork = vi.fn().mockResolvedValue(sid('child'))
  const sessions = {
    fork,
    binding: (id: SessionId) => id === sid('child') ? { sessionId: id, session: child, ctx: {} } : undefined,
  } as unknown as ISessions
  const controller = new SideChatController(sessions, sid('parent'))
  return { controller, fork, prompt, off, emit: () => { listener?.() } }
}

function failedPrompt(code = 'rejected', message = 'try again') {
  return { ok: false, error: { code, message } } as Awaited<ReturnType<SessionFace['prompt']>>
}

describe('SideChatController', () => {
  it('forks once at the addressed sequence and reuses the child', async () => {
    const b = bench()
    b.controller.open({ seq: 42, text: 'selected answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })

    b.controller.open({ seq: 99, text: 'new selection' })
    await b.controller.send('why?')

    expect(b.fork).toHaveBeenCalledTimes(1)
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'parent', atSeq: 42, increaseTitle: true })
    const sent = b.prompt.mock.calls[0]?.[0]
    expect(sent?.[0]?.type).toBe('text')
    if (sent?.[0]?.type !== 'text') throw new Error('expected a text prompt')
    expect(sent[0].text).toContain('new selection')
    expect(b.prompt.mock.calls[0]?.[1]).toBe('queue')
  })

  it('delivers the quote once, then sends ordinary follow-ups', async () => {
    const b = bench()
    b.controller.open({ seq: 7, text: 'quoted line' })
    expect(await b.controller.send('first question')).toEqual({ ok: true })
    expect(await b.controller.send('second question')).toEqual({ ok: true })

    const firstPart = b.prompt.mock.calls[0]?.[0]?.[0]
    expect(firstPart?.type).toBe('text')
    if (firstPart?.type !== 'text') throw new Error('expected a text prompt')
    expect(firstPart.text).toContain('quoted line')
    expect(b.prompt.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: 'second question' }])
    expect(b.controller.getSnapshot().origin).toBeNull()
  })

  it('claims the submitted quote before a pending fork can observe a later selection', async () => {
    const b = bench()
    let resolveFork: ((id: SessionId) => void) | undefined
    b.fork.mockImplementation(() => new Promise<SessionId>((resolve) => { resolveFork = resolve }))
    b.controller.open({ seq: 7, text: 'first quote' })
    const sending = b.controller.send('first question')
    b.controller.open({ seq: 8, text: 'later quote' })
    resolveFork?.(sid('child'))

    expect(await sending).toEqual({ ok: true })
    const firstPart = b.prompt.mock.calls[0]?.[0]?.[0]
    if (firstPart?.type !== 'text') throw new Error('expected a text prompt')
    expect(firstPart.text).toContain('first quote')
    expect(firstPart.text).not.toContain('later quote')
    expect(b.controller.getSnapshot().origin?.text).toBe('later quote')
  })

  it('rejects a concurrent send so one quote cannot be consumed twice', async () => {
    const b = bench()
    let resolveFork: ((id: SessionId) => void) | undefined
    b.fork.mockImplementation(() => new Promise<SessionId>((resolve) => { resolveFork = resolve }))
    b.controller.open({ seq: 7, text: 'single quote' })
    const first = b.controller.send('first question')
    expect(await b.controller.send('second question')).toEqual({ ok: false, error: 'send-in-progress' })
    resolveFork?.(sid('child'))

    expect(await first).toEqual({ ok: true })
    expect(b.prompt).toHaveBeenCalledOnce()
  })

  it('restores a claimed quote after failure and clears the error after retry', async () => {
    const b = bench()
    b.prompt.mockResolvedValueOnce(failedPrompt()).mockResolvedValueOnce({ ok: true, value: { accepted: true } })
    b.controller.open({ seq: 7, text: 'retry quote' })

    expect(await b.controller.send('first attempt')).toEqual({ ok: false, error: 'rejected: try again' })
    expect(b.controller.getSnapshot()).toMatchObject({
      origin: { seq: 7, text: 'retry quote' },
      error: 'rejected: try again',
    })

    expect(await b.controller.send('second attempt')).toEqual({ ok: true })
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'ready', origin: null, error: null })
    const retryPart = b.prompt.mock.calls[1]?.[0]?.[0]
    if (retryPart?.type !== 'text') throw new Error('expected a text prompt')
    expect(retryPart.text).toContain('retry quote')
  })

  it('does not overwrite a newer quote when an earlier send fails', async () => {
    const b = bench()
    let resolvePrompt: ((value: Awaited<ReturnType<SessionFace['prompt']>>) => void) | undefined
    b.prompt.mockImplementationOnce(() => new Promise((resolve) => { resolvePrompt = resolve }))
    b.controller.open({ seq: 7, text: 'old quote' })
    const sending = b.controller.send('question')
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    b.controller.open({ seq: 8, text: 'new quote' })
    resolvePrompt?.(failedPrompt())

    expect(await sending).toEqual({ ok: false, error: 'rejected: try again' })
    expect(b.controller.getSnapshot().origin).toEqual({ seq: 8, text: 'new quote' })
  })

  it('mirrors child changes and detaches on dispose', async () => {
    const b = bench()
    const notify = vi.fn()
    b.controller.subscribe(notify)
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    const before = notify.mock.calls.length
    b.emit()
    expect(notify.mock.calls.length).toBe(before + 1)

    b.controller.dispose()
    expect(b.off).toHaveBeenCalledOnce()
    b.emit()
    expect(notify.mock.calls.length).toBe(before + 1)
  })
})
