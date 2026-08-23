/** Side Chat browser registration lifecycle over a real Cordis Context. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { parseAnnotations } from '../src/client/annotation-format.ts'
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
      'conversation.chat.user-body': { kind: 'chain', scope: 'session' },
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
  let occurrences: Array<{
    occurrenceId: number
    source: string
    ref: string
    label: string
    clipboardText: string
    offset: number
    length: number
  }> = []
  let occurrenceSeq = 0
  const inputListeners = new Set<() => void>()
  const publishInput = (): void => { for (const listener of inputListeners) listener() }
  let insertAccepted = true
  // Mirrors the real input machine: a reference occupies its whole display
  // text (`@<label>`) plus a separating space, never a single sentinel char.
  const displayText = (label: string): string => `@${label}`
  const setDraft = vi.fn((text: string) => {
    draft = text
    draftRev += 1
    const current = occurrences[0]
    const offset = current === undefined ? -1 : draft.indexOf(displayText(current.label))
    occurrences = current === undefined || offset < 0 ? [] : [{ ...current, offset }]
    publishInput()
  })
  const insertReference = vi.fn((
    reference: { source: string; ref: string; label: string; clipboardText: string },
    span: { start: number; end: number },
  ) => {
    if (!insertAccepted) return false
    const text = displayText(reference.label)
    const tail = draft.slice(span.end)
    const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
    draft = `${draft.slice(0, span.start)}${text}${gap}${tail}`
    draftRev += 1
    occurrenceSeq += 1
    occurrences = [{
      occurrenceId: occurrenceSeq,
      ...reference,
      offset: span.start,
      length: text.length,
    }]
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
    expect(b.ctx.slots.entries('conversation.chat.user-body')).toHaveLength(1)
  })

  it('elects the user-body chain only for bubbles that carry an annotation attachment', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)
    const staged = face?.addToConversation({ seq: 31, text: '被引用的一段' })
    face?.updateAnnotation(staged!.id, '这里怎么理解？')

    const entry = b.ctx.slots.entries('conversation.chat.user-body')[0]
    const select = entry?.select as ((owner: { text: string }) => unknown) | undefined
    const bundleRef = b.insertReference.mock.calls.at(-1)?.[0].ref
    if (bundleRef === undefined) throw new Error('missing annotation bundle ref')
    const sent = await b.registerSource.mock.calls[0]?.[0].codec?.serialize(
      bundleRef, new AbortController().signal,
    )

    expect(select?.({ text: `${sent ?? ''}\n补充` })).toEqual({
      items: [{ seq: 31, text: '被引用的一段', annotation: '这里怎么理解？' }],
      request: '补充',
    })
    expect(select?.({ text: 'an ordinary question' })).toBeNull()
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
    face?.activateAnnotation(null)
    expect(face?.hooks.annotations.getSnapshot().activeId).toBeNull()
    const second = face?.addToConversation({ seq: 13, text: 'another answer' })

    expect(first).toMatchObject({ id: 1, order: 1, comment: '' })
    expect(second).toMatchObject({ id: 2, order: 2, comment: '' })
    expect(b.insertReference).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'answer-annotation',
      label: '2 条注释',
    }), expect.objectContaining({ start: 0, end: 0 }))
    // Relabelling from one annotation to two replaces the whole display run;
    // a stranded fragment of the old label would corrupt the sent attachment.
    expect(b.getDraft()).toBe('@2 条注释 \nexisting question')
    expect(b.getOccurrences()).toHaveLength(1)
    expect(b.prompt).not.toHaveBeenCalled()

    const source = b.registerSource.mock.calls[0]?.[0]
    const bundleRef = b.insertReference.mock.calls.at(-1)?.[0].ref
    if (bundleRef === undefined) throw new Error('missing annotation bundle ref')
    await expect(source?.codec?.serialize(bundleRef, new AbortController().signal))
      .resolves.toContain('{"seq":12,"text":"selected\\nanswer","annotation":"explain this"}')
    await expect(source?.codec?.serialize(bundleRef, new AbortController().signal))
      .resolves.toContain('{"seq":13,"text":"another answer","annotation":null}')
    await expect(source?.candidates({} as never, {} as never)).resolves.toEqual([])
    expect(source?.onPick({} as never)).toBeUndefined()
  })

  it('serializes answer annotations as one tagged, parseable attachment block', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.actionFace('parent' as SessionId)

    const first = face?.addToConversation({
      seq: 21,
      text: '计数)、G-4（[候选] *默认* `路由`）',
    })
    face?.updateAnnotation(first!.id, '什么意思？')
    face?.addToConversation({ seq: 22, text: '第二段\n引用' })

    const source = b.registerSource.mock.calls[0]?.[0]
    const bundleRef = b.insertReference.mock.calls.at(-1)?.[0].ref
    if (bundleRef === undefined) throw new Error('missing annotation bundle ref')
    const text = await source?.codec?.serialize(bundleRef, new AbortController().signal)
    expect(text).toBe([
      '# 回复注释：',
      '每一项是从此前回复中选中的文本，可能附带用户评论。按数组顺序视为注释 1、注释 2，依此类推。'
      + '把每段选中文本都当作上下文，并回应每一条评论。回应某条注释时，在正文里内联写出它的指令'
      + ' `:dsh-annotation{index="N"}`，N 是它在数组里的一基序号（例如 `:dsh-annotation{index="1"}`）。'
      + '不要使用其他形式的注释标签。',
      '<response-annotations>',
      '[{"seq":21,"text":"计数)、G-4（[候选] *默认* `路由`）","annotation":"什么意思？"},'
      + '{"seq":22,"text":"第二段\\n引用","annotation":null}]',
      '</response-annotations>',
      '',
      '## 我的请求：',
    ].join('\n'))
    expect(parseAnnotations(`${text ?? ''}\n补充问题`)).toEqual({
      items: [
        { seq: 21, text: '计数)、G-4（[候选] *默认* `路由`）', annotation: '什么意思？' },
        { seq: 22, text: '第二段\n引用', annotation: null },
      ],
      request: '补充问题',
    })
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
    expect(() => source?.codec?.clipboardText('missing-bundle')).toThrow(/is unavailable/)
    const abort = new AbortController()
    abort.abort()
    expect(() => source?.codec?.serialize('annotation', abort.signal)).toThrow()
  })

  it('keeps the Host half behavior-free', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
