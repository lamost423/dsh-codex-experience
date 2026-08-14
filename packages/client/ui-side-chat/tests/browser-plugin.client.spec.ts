/** Side Chat browser registration lifecycle over a real Cordis Context. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client/index.ts'
import type { SideChatInjected } from '../src/client/slots.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-body-overlay': { kind: 'list', scope: 'session' },
      'conversation.details.view': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  let sessionCtx: Context | undefined
  let bindingEnabled = true
  const sessionFiber = ctx.plugin({
    apply(scoped: Context) { sessionCtx = scoped },
  })
  await sessionFiber.await()
  const fork = vi.fn().mockResolvedValue('child')
  const discardEphemeral = vi.fn().mockResolvedValue(undefined)
  const prompt = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
  const childSession = {
    getSnapshot: () => ({ openState: 'open', openError: null, chat: { order: [], nodes: new Map() } }),
    subscribe: () => () => {},
    open: vi.fn().mockResolvedValue(undefined),
    prompt,
  }
  ctx.provide('sessions', {
    fork,
    discardEphemeral,
    prompt,
    binding: (sessionId: SessionId) => !bindingEnabled || sessionCtx === undefined
      ? undefined
      : { sessionId, session: childSession, ctx: sessionCtx },
  } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  ctx.provide('layout', layout)
  let draft = 'existing question'
  let draftRev = 1
  let occurrences: Array<{ occurrenceId: number; source: string; ref: string; label: string; clipboardText: string; offset: number }> = []
  let occurrenceSeq = 0
  const inputListeners = new Set<() => void>()
  const publishInput = (): void => { for (const listener of inputListeners) listener() }
  let insertAccepted = true
  const setDraft = vi.fn((text: string) => {
    draft = text
    draftRev += 1
    const offset = draft.indexOf('￼')
    occurrences = offset < 0 ? [] : occurrences.map(item => ({ ...item, offset }))
    publishInput()
  })
  const insertReference = vi.fn((
    reference: { source: string; ref: string; label: string; clipboardText: string },
    span: { start: number; end: number },
  ) => {
    if (!insertAccepted) return false
    draft = `${draft.slice(0, span.start)}￼${draft.slice(span.end)}`
    draftRev += 1
    occurrenceSeq += 1
    occurrences = [{ occurrenceId: occurrenceSeq, ...reference, offset: span.start }]
    publishInput()
    return true
  })
  ctx.provide('conversation', {
    input: { for: vi.fn(() => ({
      state: {
        getSnapshot: () => ({ draft, draftRev, occurrences }),
        subscribe: (listener: () => void) => { inputListeners.add(listener); return () => { inputListeners.delete(listener) } },
      },
      setDraft,
      insertReference,
    })) },
  } as never)
  const offSource = vi.fn()
  const registerSource = vi.fn<(source: InputTriggerSource) => () => void>(() => offSource)
  ctx.provide('inputTriggers', { registerSource } as never)
  return {
    ctx,
    sessionFiber,
    fiber: ctx.plugin({ inject: [...inject], apply }),
    setDraft,
    insertReference,
    registerSource,
    offSource,
    layout,
    fork,
    discardEphemeral,
    prompt,
    setInsertAccepted: (accepted: boolean) => { insertAccepted = accepted },
    setCurrentDraft: (value: string) => { draft = value; draftRev += 1 },
    setBindingEnabled: (enabled: boolean) => { bindingEnabled = enabled },
    getDraft: () => draft,
    getOccurrences: () => occurrences,
    actionFace: (sessionId: SessionId) => {
      const entry = ctx.slots.entries('conversation.chat.assistant-actions')[0]
      return (entry?.inject as ((id: SessionId) => SideChatInjected) | undefined)?.(sessionId)
    },
    selectionFace: (sessionId: SessionId) => {
      const entry = ctx.slots.entries('conversation.chat.assistant-body-overlay')[0]
      return (entry?.inject as ((id: SessionId) => SideChatInjected) | undefined)?.(sessionId)
    },
    panelFace: (sessionId: SessionId) => {
      const entry = ctx.slots.entries('conversation.details.view')[0]
      return (entry?.inject as ((id: SessionId) => SideChatInjected) | undefined)?.(sessionId)
    },
  }
}

describe('ui-side-chat browser plugin', () => {
  it('registers all three extension entries with stable identities', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')[0]?.options).toMatchObject({
      id: 'side-chat', order: 5,
    })
    expect(b.ctx.slots.entries('conversation.chat.assistant-body-overlay')[0]?.options).toMatchObject({
      id: 'side-chat-selection', order: 0,
    })
    expect(b.ctx.slots.entries('conversation.details.view')[0]?.options).toMatchObject({
      key: 'side-chat',
    })
  })

  it('withdraws every registration on disposal and reloads without duplicates', async () => {
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.assistant-body-overlay')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.details.view')).toHaveLength(0)
    expect(b.offSource).toHaveBeenCalledOnce()

    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()
    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(1)
    expect(b.ctx.slots.entries('conversation.chat.assistant-body-overlay')).toHaveLength(1)
    expect(b.ctx.slots.entries('conversation.details.view')).toHaveLength(1)
  })

  it('disposes a controller with its parent Session scope', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    expect(face).toBeDefined()
    await b.sessionFiber.dispose()

    face?.open({ seq: 7, text: 'must not survive' })
    expect(face?.hooks.sideChat.getSnapshot().origin).toBeNull()
  })

  it('stages multiple annotations behind one composer count chip without prompting', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)

    const first = face?.addToConversation({ seq: 12, text: 'selected\nanswer' })
    face?.updateAnnotation(first!.id, 'explain this')
    const second = face?.addToConversation({ seq: 13, text: 'another answer' })

    expect(first).toMatchObject({ id: 1, order: 1, comment: '' })
    expect(second).toMatchObject({ id: 2, order: 2, comment: '' })
    expect(b.insertReference).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'answer-annotation',
      label: '2 条注释',
    }), expect.objectContaining({ start: 0, end: 0 }))
    expect(b.getDraft().split('￼')).toHaveLength(2)
    expect(b.getOccurrences()).toHaveLength(1)
    expect(b.prompt).not.toHaveBeenCalled()

    const source = b.registerSource.mock.calls[0]?.[0]
    const bundleRef = b.insertReference.mock.calls.at(-1)?.[0].ref
    if (bundleRef === undefined) throw new Error('missing annotation bundle ref')
    await expect(source?.codec?.serialize(bundleRef, new AbortController().signal))
      .resolves.toContain('[注释 1：selected answer](#dsh-message-12)')
    await expect(source?.codec?.serialize(bundleRef, new AbortController().signal))
      .resolves.toContain('explain this')
    await expect(source?.codec?.serialize(bundleRef, new AbortController().signal))
      .resolves.toContain('[注释 2：another answer](#dsh-message-13)')
    await expect(source?.candidates({} as never, {} as never)).resolves.toEqual([])
    expect(source?.onPick({} as never)).toBeUndefined()
  })

  it('clears every staged annotation after the aggregate composer chip is sent or deleted', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    face?.addToConversation({ seq: 7, text: 'first' })
    face?.addToConversation({ seq: 8, text: 'second' })
    expect(face?.hooks.annotations.getSnapshot().annotations).toHaveLength(2)

    b.setDraft('')

    expect(face?.hooks.annotations.getSnapshot()).toEqual({ annotations: [], activeId: null })
  })

  it('restores the draft when annotation staging is rejected', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    b.setInsertAccepted(false)
    expect(face?.addToConversation({ seq: 4, text: 'answer' })).toBeNull()
    expect(b.setDraft).toHaveBeenLastCalledWith('existing question')

    b.setCurrentDraft('   ')
    face?.addToConversation({ seq: 5, text: 'answer' })
    expect(b.insertReference).toHaveBeenCalledTimes(2)
    face?.addToConversation({ seq: 6, text: '   ' })
    expect(b.insertReference).toHaveBeenCalledTimes(2)
  })

  it('opens in the current details column and reuses one controller across entries', async () => {
    const b = await bench()
    await b.fiber.await()
    const action = b.actionFace('parent' as SessionId)
    const selection = b.selectionFace('parent' as SessionId)
    const panel = b.panelFace('parent' as SessionId)
    expect(action?.hooks.sideChat).toBe(selection?.hooks.sideChat)
    expect(action?.hooks.sideChat).toBe(panel?.hooks.sideChat)

    action?.open({ seq: 2, text: 'answer' })
    expect(b.layout.openDetails).toHaveBeenCalledWith('side-chat')
    expect(await action?.send('')).toEqual({ ok: false, error: 'empty-message' })
    action?.close()
    expect(b.layout.closeDetails).toHaveBeenCalledOnce()
    await expect(action?.release()).resolves.toBeUndefined()
  })

  it('throws when an entry is requested for an unbound parent', async () => {
    const b = await bench()
    await b.fiber.await()
    b.setBindingEnabled(false)
    expect(() => b.actionFace('missing' as SessionId)).toThrow(/is not bound/)
  })

  it('throws if the parent disappears before composer annotation insertion', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    b.setBindingEnabled(false)
    expect(() => face?.addToConversation({ seq: 1, text: 'answer' })).toThrow(/is not bound/)
  })

  it('logs a close failure while retaining the controller for retry', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    face?.open({ seq: 1, text: 'answer' })
    await vi.waitFor(() => { expect(face?.hooks.sideChat.getSnapshot().phase).toBe('ready') })
    const failure = new Error('discard failed')
    b.discardEphemeral.mockRejectedValueOnce(failure)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    face?.close()
    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('[ui-side-chat] close failed:', failure) })
    await expect(face?.release()).resolves.toBeUndefined()
    error.mockRestore()
  })

  it('disposes controllers still owned by the plugin on plugin teardown', async () => {
    const b = await bench()
    await b.fiber.await()
    b.actionFace('parent' as SessionId)
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('conversation.details.view')).toHaveLength(0)
  })

  it('honors an aborted annotation serialization', async () => {
    const b = await bench()
    await b.fiber.await()
    const source = b.registerSource.mock.calls[0]?.[0]
    const abort = new AbortController()
    abort.abort()
    expect(() => source?.codec?.serialize('annotation', abort.signal)).toThrow()
  })

  it('keeps the Host half behavior-free', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
