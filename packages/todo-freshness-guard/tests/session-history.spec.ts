import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as TodoFreshness from '../src/index.ts'

type Reader = 'events' | 'snapshot' | 'none'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Expose an rc.6 Session the way each Host generation does: the `events` getter
 * (through 0.1.2-alpha.3), `snapshotEvents()` alone (0.1.2-alpha.4 and later), or neither.
 */
function withReader(session: Session, reader: Reader): Session {
  if (reader === 'events') return session
  return new Proxy(session, {
    get(target, key) {
      if (key === 'events') return undefined
      if (key === 'snapshotEvents') return reader === 'snapshot' ? () => target.events : undefined
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Mount the guard after an active todo list was logged, as a remount mid-turn does. */
async function remountedGuard(reader: Reader) {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  const calls: string[] = []
  ctx.tools.register(defineTool({
    name: 'probe', description: 'Record a call.', parameters: { label: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: (args) => { calls.push(args.label); return Promise.resolve(args.label) },
  }))
  const scope = ctx.plugin(() => {})
  const session = ctx.sessions.create(SessionId(`history-${reader}`))
  session.append('todo/write', { todos: [{ content: 'work', status: 'in_progress' }] })
  const agent: Agent = {
    id: session.id,
    options: {},
    session: withReader(session, reader),
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  await ctx.plugin(TodoFreshness, { reminderAfterCalls: 1, blockAfterCalls: 2 })
  const probe = (label: string) => ctx.tools.execute({
    signal: new AbortController().signal, callId: CallId(label), name: 'probe', arguments: { label }, agent,
  })
  return { calls, probe }
}

describe('todo recovery after a mid-turn remount', () => {
  it.each(['events', 'snapshot'] as const)('recovers the active list through the %s reader', async (reader) => {
    const { calls, probe } = await remountedGuard(reader)

    await probe('first')
    await probe('second')
    const blocked = await probe('blocked')

    expect(blocked.isError).toBe(true)
    expect(calls).toEqual(['first', 'second'])
  })

  it('leaves enforcement off instead of failing calls when the Host exposes no Session log reader', async () => {
    const { calls, probe } = await remountedGuard('none')

    const failures = [(await probe('first')).isError, (await probe('second')).isError, (await probe('third')).isError]

    expect(failures).toEqual([false, false, false])
    expect(calls).toEqual(['first', 'second', 'third'])
  })
})
