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
  const discardEphemeral = vi.fn().mockResolvedValue(undefined)
  const binding = vi.fn((id: SessionId) => id === sid('child')
    ? { sessionId: id, session: child, ctx: {} }
    : undefined)
  const sessions = {
    fork,
    discardEphemeral,
    binding,
  } as unknown as ISessions
  const controller = new SideChatController(sessions, sid('parent'))
  return { controller, fork, discardEphemeral, binding, prompt, off, emit: () => { listener?.() } }
}

function failedPrompt(code = 'rejected', message = 'try again') {
  return { ok: false, error: { code, message } } as Awaited<ReturnType<SessionFace['prompt']>>
}

describe('SideChatController', () => {
  it('rejects empty input and sends an unanchored prompt without an atSeq', async () => {
    const b = bench()
    expect(await b.controller.send('   ')).toEqual({ ok: false, error: 'empty-message' })
    expect(await b.controller.send(' plain question ')).toEqual({ ok: true })
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'parent', ephemeral: true })
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'plain question' }], 'queue')
  })

  it('bounds an oversized quote before delivery', async () => {
    const b = bench()
    b.controller.open({ seq: 1, text: `  ${'x'.repeat(4_010)}  ` })
    expect(b.controller.getSnapshot().origin?.text).toHaveLength(4_001)
    expect(b.controller.getSnapshot().origin?.text.endsWith('…')).toBe(true)
  })

  it('forks once at the addressed sequence and reuses the child', async () => {
    const b = bench()
    b.controller.open({ seq: 42, text: 'selected answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })

    b.controller.open({ seq: 99, text: 'new selection' })
    await b.controller.send('why?')

    expect(b.fork).toHaveBeenCalledTimes(1)
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'parent', atSeq: 42, ephemeral: true })
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

  it('normalizes thrown prompt and fork failures', async () => {
    const promptFailure = bench()
    promptFailure.prompt.mockRejectedValueOnce('prompt exploded')
    expect(await promptFailure.controller.send('question')).toEqual({ ok: false, error: 'prompt exploded' })
    expect(promptFailure.controller.getSnapshot().phase).toBe('error')

    const forkFailure = bench()
    forkFailure.fork.mockRejectedValueOnce(new Error('fork exploded'))
    forkFailure.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(forkFailure.controller.getSnapshot()).toMatchObject({ phase: 'error', error: 'fork exploded' }) })

    const nonErrorFork = bench()
    nonErrorFork.fork.mockRejectedValueOnce('plain fork failure')
    nonErrorFork.controller.open({ seq: 2, text: 'answer' })
    await vi.waitFor(() => { expect(nonErrorFork.controller.getSnapshot().error).toBe('plain fork failure') })
  })

  it('restores an anchored quote after a thrown prompt unless a newer quote replaced it', async () => {
    const restored = bench()
    restored.prompt.mockRejectedValueOnce(new Error('transport failed'))
    restored.controller.open({ seq: 1, text: 'old quote' })
    expect(await restored.controller.send('question')).toEqual({ ok: false, error: 'transport failed' })
    expect(restored.controller.getSnapshot().origin).toEqual({ seq: 1, text: 'old quote' })

    const retained = bench()
    let rejectPrompt: ((error: unknown) => void) | undefined
    retained.prompt.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrompt = reject }))
    retained.controller.open({ seq: 1, text: 'old quote' })
    const sending = retained.controller.send('question')
    await vi.waitFor(() => { expect(retained.prompt).toHaveBeenCalledOnce() })
    retained.controller.open({ seq: 2, text: 'new quote' })
    rejectPrompt?.(new Error('transport failed'))
    await sending
    expect(retained.controller.getSnapshot().origin).toEqual({ seq: 2, text: 'new quote' })
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

    await b.controller.dispose()
    expect(b.off).toHaveBeenCalledOnce()
    expect(b.discardEphemeral).toHaveBeenCalledWith(sid('child'))
    const afterDispose = notify.mock.calls.length
    b.emit()
    expect(notify.mock.calls.length).toBe(afterDispose)
  })

  it('supports unsubscribe and contains subscriber failures', async () => {
    const b = bench()
    const removed = vi.fn()
    const off = b.controller.subscribe(removed)
    off()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.controller.subscribe(() => { throw new Error('observer failed') })
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
    expect(removed).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('destroys the ephemeral child on close and creates a fresh one next time', async () => {
    const b = bench()
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })

    await b.controller.close()
    expect(b.discardEphemeral).toHaveBeenCalledWith(sid('child'))
    expect(b.controller.getSnapshot()).toMatchObject({ childSessionId: null, phase: 'idle' })

    b.controller.open({ seq: 2, text: 'again' })
    await vi.waitFor(() => { expect(b.fork).toHaveBeenCalledTimes(2) })
  })

  it('closes an idle controller without issuing a discard', async () => {
    const b = bench()
    await b.controller.close()
    expect(b.discardEphemeral).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().phase).toBe('idle')
  })

  it('waits for an in-flight fork before discarding the child', async () => {
    const b = bench()
    let resolveFork: ((id: SessionId) => void) | undefined
    b.fork.mockImplementation(() => new Promise<SessionId>((resolve) => { resolveFork = resolve }))
    b.controller.open({ seq: 1, text: 'answer' })

    const closing = b.controller.close()
    expect(b.discardEphemeral).not.toHaveBeenCalled()
    resolveFork?.(sid('child'))
    await closing

    expect(b.discardEphemeral).toHaveBeenCalledWith(sid('child'))
    expect(b.controller.getSnapshot()).toMatchObject({ childSessionId: null, phase: 'idle' })
  })

  it('coalesces closes and blocks open/send while teardown is pending', async () => {
    const b = bench()
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    let finishDiscard: (() => void) | undefined
    b.discardEphemeral.mockImplementation(() => new Promise<void>((resolve) => { finishDiscard = resolve }))
    const first = b.controller.close()
    const second = b.controller.close()
    b.controller.open({ seq: 2, text: 'ignored' })
    expect(await b.controller.send('ignored')).toEqual({ ok: false, error: 'side-chat-closing' })
    expect(b.controller.getSnapshot().origin).toEqual({ seq: 1, text: 'answer' })
    finishDiscard?.()
    await Promise.all([first, second])
    expect(b.discardEphemeral).toHaveBeenCalledOnce()
  })

  it('retains the child capability after discard failure and retries it', async () => {
    const b = bench()
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    b.discardEphemeral.mockRejectedValueOnce(new Error('temporary teardown failure'))

    await expect(b.controller.close()).rejects.toThrow('temporary teardown failure')
    expect(b.controller.getSnapshot().childSessionId).toBe(sid('child'))
    expect(b.off).not.toHaveBeenCalled()
    await b.controller.close()

    expect(b.discardEphemeral).toHaveBeenCalledTimes(2)
    expect(b.off).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot().childSessionId).toBeNull()
  })

  it('discards a fork that cannot be bound on the client', async () => {
    const b = bench()
    b.binding.mockReturnValue(undefined)
    b.controller.open({ seq: 1, text: 'answer' })

    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('error') })
    expect(b.discardEphemeral).toHaveBeenCalledWith(sid('child'))
  })

  it('releases cleanly when an in-flight fork fails during close', async () => {
    const b = bench()
    let rejectFork: ((error: unknown) => void) | undefined
    b.fork.mockImplementation(() => new Promise<SessionId>((_resolve, reject) => { rejectFork = reject }))
    b.controller.open({ seq: 1, text: 'answer' })
    const closing = b.controller.close()
    rejectFork?.(new Error('fork failed while closing'))
    await closing
    expect(b.controller.getSnapshot()).toMatchObject({ childSessionId: null, phase: 'idle' })
  })

  it('coalesces parent disposal and waits for an in-flight fork before discarding it', async () => {
    const b = bench()
    let resolveFork: ((id: SessionId) => void) | undefined
    b.fork.mockImplementation(() => new Promise<SessionId>((resolve) => { resolveFork = resolve }))
    b.controller.open({ seq: 1, text: 'answer' })
    const first = b.controller.dispose()
    const second = b.controller.dispose()
    b.controller.open({ seq: 2, text: 'ignored' })
    expect(await b.controller.send('during dispose')).toEqual({ ok: false, error: 'side-chat-closing' })
    resolveFork?.(sid('child'))
    await Promise.all([first, second])
    expect(b.discardEphemeral).toHaveBeenCalledWith(sid('child'))
    expect(await b.controller.send('after dispose')).toMatchObject({ ok: false })
    await b.controller.dispose()
    await b.controller.close()
  })

  it('retains the child after failed parent disposal and allows teardown retry', async () => {
    const b = bench()
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    b.discardEphemeral.mockRejectedValueOnce(new Error('dispose failed'))
    await expect(b.controller.dispose()).rejects.toThrow('dispose failed')
    expect(b.controller.getSnapshot().childSessionId).toBe(sid('child'))
    await b.controller.dispose()
    expect(b.discardEphemeral).toHaveBeenCalledTimes(2)
  })

  it('does not restore state after a send finishes beyond close generation', async () => {
    const b = bench()
    let resolvePrompt: ((value: Awaited<ReturnType<SessionFace['prompt']>>) => void) | undefined
    b.prompt.mockImplementationOnce(() => new Promise((resolve) => { resolvePrompt = resolve }))
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    const sending = b.controller.send('question')
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    await b.controller.close()
    resolvePrompt?.({ ok: true, value: { accepted: true } })
    expect(await sending).toEqual({ ok: true })
    expect(b.controller.getSnapshot().phase).toBe('idle')
  })

  it('does not restore an old quote when a prompt rejects after close', async () => {
    const b = bench()
    let rejectPrompt: ((error: unknown) => void) | undefined
    b.prompt.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrompt = reject }))
    b.controller.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(b.controller.getSnapshot().phase).toBe('ready') })
    const sending = b.controller.send('question')
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    await b.controller.close()
    rejectPrompt?.(new Error('late failure'))
    expect(await sending).toEqual({ ok: false, error: 'late failure' })
    expect(b.controller.getSnapshot()).toMatchObject({ origin: null, phase: 'idle', error: null })
  })
})
