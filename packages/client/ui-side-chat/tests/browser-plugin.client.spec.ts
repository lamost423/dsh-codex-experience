/** Side Chat browser registration lifecycle over a real Cordis Context. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
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
  const sessionFiber = ctx.plugin({
    apply(scoped: Context) { sessionCtx = scoped },
  })
  await sessionFiber.await()
  ctx.provide('sessions', {
    fork: vi.fn(),
    binding: (sessionId: SessionId) => sessionCtx === undefined
      ? undefined
      : { sessionId, session: {}, ctx: sessionCtx },
  } as never)
  ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  return {
    ctx,
    sessionFiber,
    fiber: ctx.plugin({ inject: [...inject], apply }),
    actionFace: (sessionId: SessionId) => {
      const entry = ctx.slots.entries('conversation.chat.assistant-actions')[0]
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

  it('keeps the Host half behavior-free', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
