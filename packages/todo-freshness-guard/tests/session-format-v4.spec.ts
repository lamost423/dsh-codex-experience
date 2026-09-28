import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as TodoFreshness from '../src/index.ts'

// Host 0.1.7 writes Session format 4, which refuses `source.kind === 'plugin'`;
// the pinned rc.6 packages write format 0, so only the guard sees version 4 here.
vi.mock('@deepseek-ai/dsh-session', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-session')>(),
  SESSION_FORMAT_VERSION: 4,
}))

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

function owner(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const session = ctx.sessions.create(SessionId('format-v4-owner'))
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
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
  return agent
}

describe('Session format 4 attribution', () => {
  it('attributes the reminder to the guard\'s own producer kind', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
    await ctx.plugin(TodoFreshness, { reminderAfterCalls: 1, blockAfterCalls: 3 })
    ctx.tools.register(defineTool({
      name: 'probe', description: 'Record a call.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('ok'),
    }))
    const agent = owner(ctx)
    const signal = new AbortController().signal
    await ctx.tools.execute({
      signal, callId: CallId('todo'), name: 'todo_write', agent,
      arguments: { todos: [{ content: 'work', status: 'in_progress' }] },
    })

    const reminded = await ctx.tools.execute({ signal, callId: CallId('p1'), name: 'probe', arguments: {}, agent })

    // The V3-to-V4 migration maps `{ kind: 'plugin', plugin: 'todo-freshness-guard' }`
    // to exactly this source, so migrated and newly written reminders agree.
    expect(reminded.additionalContexts?.map(context => context.source)).toEqual([
      { kind: 'plugin:todo-freshness-guard', form: 'notice', summary: 'Todo status stale after 1 calls' },
    ])
  })
})
