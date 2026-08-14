import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as TodoFreshness from '@deepseek-ai/dsh-todo-freshness-guard'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function owner(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const session = ctx.sessions.create(SessionId('loader-owner'))
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

async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-todo-freshness-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-todo'",
    '  config:',
    '    allowParallelInProgress: true',
    "- name: '@deepseek-ai/dsh-todo-freshness-guard'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-todo', ToolTodo],
    ['@deepseek-ai/dsh-todo-freshness-guard', TodoFreshness],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('todo freshness real Loader composition through cordis.yml', () => {
  it('enforces the configured thresholds on the assembled tool pipeline', async () => {
    const ctx = await boot(['    reminderAfterCalls: 1', '    blockAfterCalls: 2'])
    const calls: string[] = []
    ctx.tools.register(defineTool({
      name: 'probe', description: 'Record a call.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => { calls.push('probe'); return Promise.resolve('ok') },
    }))
    const agent = owner(ctx)
    const signal = new AbortController().signal
    await ctx.tools.execute({
      signal, callId: CallId('todo'), name: 'todo_write', agent,
      arguments: { todos: [{ content: 'work', status: 'in_progress' }] },
    })
    await ctx.tools.execute({ signal, callId: CallId('p1'), name: 'probe', arguments: {}, agent })
    await ctx.tools.execute({ signal, callId: CallId('p2'), name: 'probe', arguments: {}, agent })
    const blocked = await ctx.tools.execute({ signal, callId: CallId('p3'), name: 'probe', arguments: {}, agent })

    expect(calls).toEqual(['probe', 'probe'])
    expect(blocked.isError).toBe(true)
    expect(blocked.content).toEqual([{
      type: 'text', text: 'Error: task status is stale after 2 tool calls since the latest todo_write; '
        + 'call todo_write with the complete reconciled list before using another tool',
    }])
  }, 30_000)

  it.each([
    { label: 'is omitted', lines: [], failure: '$.reminderAfterCalls missing required value' },
    {
      label: 'orders block before reminder',
      lines: ['    reminderAfterCalls: 4', '    blockAfterCalls: 3'],
      failure: 'must be an integer greater than reminderAfterCalls',
    },
  ])('fails loading when config $label', async ({ lines, failure }) => {
    await expect(boot(lines)).rejects.toThrow(failure)
  }, 30_000)
})
