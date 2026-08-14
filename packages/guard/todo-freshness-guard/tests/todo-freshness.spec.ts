import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as TodoFreshness from '@deepseek-ai/dsh-todo-freshness-guard'
import type { Config } from '@deepseek-ai/dsh-todo-freshness-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const CONFIG: Config = { reminderAfterCalls: 2, blockAfterCalls: 3 }
const ACTIVE_TODOS = [{ content: 'ship the fix', status: 'in_progress' as const }]

/** Scriptable Code Mode runtime used to drive real SDK sub-dispatches without evaluating model code. */
class FakeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function pluginMessages(agent: Agent): Extract<SessionEvent, { type: 'user/message' }>[] {
  return [...agent.session.events].filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
    event.type === 'user/message' && event.data.source.kind === 'plugin')
}

function resultText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return event.data.message.content
    .flatMap(block => block.type === 'tool-result' ? block.content : [])
    .map(block => block.type === 'text' ? block.text : '')
    .join('')
}

/** Mount the real loop, todo tool, guard, and one observable work tool. */
async function harness(config: Config = CONFIG, mode: 'native' | 'code' = 'native') {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { tools: { mode } })
  let runtime: FakeRuntime | undefined
  if (mode === 'code') {
    await ctx.plugin(FakeRuntime)
    runtime = ctx.codeRuntime as FakeRuntime
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  const guard = await ctx.plugin(TodoFreshness, config)
  const calls: string[] = []
  ctx.tools.register(defineTool({
    name: 'probe',
    description: 'Record one work call.',
    parameters: { label: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      calls.push(args.label)
      return Promise.resolve(args.label)
    },
  }))
  return { ctx, runtime, guard, calls }
}

describe('native todo freshness enforcement', () => {
  it('reminds at the advisory threshold, blocks after the allowance, and resets on todo_write', async () => {
    const { ctx, calls } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('todo-1', 'todo_write', { todos: ACTIVE_TODOS }),
      toolCallResponse('p1', 'probe', { label: 'one' }),
      toolCallResponse('p2', 'probe', { label: 'two' }),
      toolCallResponse('p3', 'probe', { label: 'three' }),
      toolCallResponse('p4', 'probe', { label: 'blocked' }),
      toolCallResponse('todo-2', 'todo_write', { todos: ACTIVE_TODOS }),
      toolCallResponse('p5', 'probe', { label: 'after-reset' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('native'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(calls).toEqual(['one', 'two', 'three', 'after-reset'])
    const reminders = pluginMessages(agent).filter(event =>
      event.data.source.kind === 'plugin' && event.data.source.plugin === 'todo-freshness-guard')
    expect(reminders).toHaveLength(1)
    expect(reminders[0]?.data.content).toEqual([{
      type: 'text',
      text: 'Task status is stale: 2 non-bookkeeping tool calls have run since the latest todo_write. '
        + 'Reconcile the complete task list now: mark finished items completed, mark every active item in_progress, '
        + 'and call todo_write before continuing.',
    }])
    expect(reminders[0]?.data.source).toEqual({
      kind: 'plugin', plugin: 'todo-freshness-guard', form: 'notice', summary: 'Todo status stale after 2 calls',
    })
    const blocked = agent.session.events.find(event =>
      event.type === 'tool/result' && event.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === 'p4'))
    expect(blocked?.type).toBe('tool/result')
    if (blocked?.type !== 'tool/result') throw new Error('missing blocked tool result')
    expect(resultText(blocked)).toContain('task status is stale after 3 tool calls')
    expect(agent.session.events.filter(event => event.type === 'todo/write')).toHaveLength(2)
  })

  it('does not activate without unfinished todos, and a completed list disables an active epoch', async () => {
    const { ctx, calls } = await harness({ reminderAfterCalls: 1, blockAfterCalls: 2 })
    const adapter = new MockAdapter([
      toolCallResponse('free-1', 'probe', { label: 'no-plan-1' }),
      toolCallResponse('free-2', 'probe', { label: 'no-plan-2' }),
      toolCallResponse('todo-active', 'todo_write', { todos: ACTIVE_TODOS }),
      toolCallResponse('counted', 'probe', { label: 'counted' }),
      toolCallResponse('todo-done', 'todo_write', { todos: [{ content: 'ship the fix', status: 'completed' }] }),
      toolCallResponse('done-1', 'probe', { label: 'done-1' }),
      toolCallResponse('done-2', 'probe', { label: 'done-2' }),
      toolCallResponse('done-3', 'probe', { label: 'done-3' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('inactive'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(calls).toEqual(['no-plan-1', 'no-plan-2', 'counted', 'done-1', 'done-2', 'done-3'])
  })

  it('unmounting removes enforcement listeners', async () => {
    const { ctx, guard, calls } = await harness({ reminderAfterCalls: 1, blockAfterCalls: 2 })
    const adapter = new MockAdapter([
      toolCallResponse('todo', 'todo_write', { todos: ACTIVE_TODOS }),
      toolCallResponse('p1', 'probe', { label: 'one' }),
      toolCallResponse('p2', 'probe', { label: 'two' }),
      textResponse('first done'),
      toolCallResponse('p3', 'probe', { label: 'after-dispose-1' }),
      toolCallResponse('p4', 'probe', { label: 'after-dispose-2' }),
      toolCallResponse('p5', 'probe', { label: 'after-dispose-3' }),
      textResponse('second done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('dispose'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await guard.dispose()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(calls).toEqual(['one', 'two', 'after-dispose-1', 'after-dispose-2', 'after-dispose-3'])
  })
})

describe('Code Mode enforcement', () => {
  it('ignores the run_code transport, counts SDK sub-dispatches, and leaves todo_write reachable after a block', async () => {
    const { ctx, runtime, calls } = await harness(CONFIG, 'code')
    runtime!.behavior = async (request) => {
      const tools = request.bindings[0]!.functions
      await tools.todo_write!({ todos: ACTIVE_TODOS })
      await tools.probe!({ label: 'one' })
      await tools.probe!({ label: 'two' })
      await tools.probe!({ label: 'three' })
      const blocked = await tools.probe!({ label: 'blocked' })
        .then(() => 'unexpected success', (error: unknown) => error instanceof Error ? error.message : String(error))
      await tools.todo_write!({ todos: ACTIVE_TODOS })
      await tools.probe!({ label: 'after-reset' })
      return { logs: [], value: blocked }
    }
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('code', RUN_CODE_NAME, { code: 'fixture', description: 'Exercise todo freshness' }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('code'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(calls).toEqual(['one', 'two', 'three', 'after-reset'])
    const outer = agent.session.events.find(event =>
      event.type === 'tool/result' && event.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === 'code'))
    expect(outer?.type).toBe('tool/result')
    if (outer?.type !== 'tool/result') throw new Error('missing run_code result')
    expect(resultText(outer)).toContain('task status is stale after 3 tool calls')
    expect(agent.session.events.filter(event => event.type === 'todo/write')).toHaveLength(2)
  })
})

describe('direct tool pipeline edge cases', () => {
  it('hydrates only the latest current-turn todo list and ignores calls without an agent', async () => {
    const { ctx, guard, calls } = await harness({ reminderAfterCalls: 1, blockAfterCalls: 2 })
    await guard.dispose()
    const active = ctx.agentLoop.create(SessionId('hydrate-active'), { provider: 'mock', model: 'mock' })
    active.session.append('todo/write', { todos: ACTIVE_TODOS })
    const reset = ctx.agentLoop.create(SessionId('hydrate-reset'), { provider: 'mock', model: 'mock' })
    reset.session.append('todo/write', { todos: ACTIVE_TODOS })
    reset.session.append('turn/start', { turn: 1 })
    const empty = ctx.agentLoop.create(SessionId('hydrate-empty'), { provider: 'mock', model: 'mock' })
    empty.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'irrelevant history' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.plugin(TodoFreshness, { reminderAfterCalls: 1, blockAfterCalls: 2 })
    const signal = new AbortController().signal

    await ctx.tools.execute({ signal, callId: CallId('direct'), name: 'probe', arguments: { label: 'direct' } })
    await ctx.tools.execute({ signal, callId: CallId('active-1'), name: 'probe', arguments: { label: 'active-1' }, agent: active })
    await ctx.tools.execute({ signal, callId: CallId('active-2'), name: 'probe', arguments: { label: 'active-2' }, agent: active })
    const blocked = await ctx.tools.execute({
      signal, callId: CallId('active-3'), name: 'probe', arguments: { label: 'active-blocked' }, agent: active,
    })
    await ctx.tools.execute({ signal, callId: CallId('reset'), name: 'probe', arguments: { label: 'reset' }, agent: reset })
    await ctx.tools.execute({ signal, callId: CallId('empty'), name: 'probe', arguments: { label: 'empty' }, agent: empty })

    expect(blocked.isError).toBe(true)
    expect(calls).toEqual(['direct', 'active-1', 'active-2', 'reset', 'empty'])
  })

  it('drops a stale reminder reservation after concurrent todo refresh', async () => {
    const { ctx } = await harness({ reminderAfterCalls: 1, blockAfterCalls: 3 })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.tools.register(defineTool({
      name: 'slow_probe',
      description: 'Wait until the test releases this probe.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        entered.resolve(undefined)
        await release.promise
        return 'settled'
      },
    }))
    const agent = ctx.agentLoop.create(SessionId('concurrent-refresh'), { provider: 'mock', model: 'mock' })
    const signal = new AbortController().signal
    await ctx.tools.execute({
      signal, callId: CallId('todo-start'), name: 'todo_write', arguments: { todos: ACTIVE_TODOS }, agent,
    })
    const pending = ctx.tools.execute({
      signal, callId: CallId('slow'), name: 'slow_probe', arguments: {}, agent,
    })
    await entered.promise
    await ctx.tools.execute({
      signal, callId: CallId('todo-refresh'), name: 'todo_write', arguments: { todos: ACTIVE_TODOS }, agent,
    })
    release.resolve(undefined)

    const result = await pending
    expect(result.isError).toBe(false)
    expect(result.additionalContexts).toBeUndefined()
  })

  it('prepends its reminder to a downstream block without replacing feedback', async () => {
    const { ctx } = await harness({ reminderAfterCalls: 1, blockAfterCalls: 3 })
    const agent = ctx.agentLoop.create(SessionId('downstream-block'), { provider: 'mock', model: 'mock' })
    const signal = new AbortController().signal
    await ctx.tools.execute({
      signal, callId: CallId('todo'), name: 'todo_write', arguments: { todos: ACTIVE_TODOS }, agent,
    })
    ctx.on('tools/post-execute', async () => ({
      kind: 'block' as const,
      feedback: [{ type: 'text' as const, text: 'downstream rejected the result' }],
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'downstream context' }],
        source: { kind: 'plugin', plugin: 'downstream-test' },
      })],
    }))

    const result = await ctx.tools.execute({
      signal, callId: CallId('probe'), name: 'probe', arguments: { label: 'blocked downstream' }, agent,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'downstream rejected the result' }])
    expect(result.additionalContexts?.map(context => context.source)).toEqual([
      { kind: 'plugin', plugin: 'todo-freshness-guard', form: 'notice', summary: 'Todo status stale after 1 calls' },
      { kind: 'plugin', plugin: 'downstream-test' },
    ])
  })
})

describe('configuration', () => {
  it.each([
    [{ reminderAfterCalls: 0, blockAfterCalls: 3 }, /reminderAfterCalls 0/],
    [{ reminderAfterCalls: 1.5, blockAfterCalls: 3 }, /reminderAfterCalls 1.5/],
    [{ reminderAfterCalls: 3, blockAfterCalls: 3 }, /greater than reminderAfterCalls/],
    [{ reminderAfterCalls: 3, blockAfterCalls: 2 }, /greater than reminderAfterCalls/],
  ] as const)('rejects invalid direct config %o', async (config, failure) => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(TodoFreshness, config)).rejects.toThrow(failure)
  })
})
