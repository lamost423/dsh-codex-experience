/**
 * Per-session todo freshness enforcement. Active todo lists reserve a bounded
 * number of non-bookkeeping tool attempts before the guard requires another
 * whole-list `todo_write`; native calls and Code Mode sub-dispatches share the
 * same counter, while the outer `run_code` transport remains available so a
 * program can reach `todo_write`.
 * @module dsh-todo-freshness-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { PostToolDecision, PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** This guard's own producer kind, used where the Session format refuses the shared `plugin` kind. */
    'plugin:todo-freshness-guard': { kind: 'plugin:todo-freshness-guard' } & ContextFormed
  }
}

export const name = 'todo-freshness-guard'
export const inject = ['tools']

/** Deployment-owned thresholds for todo freshness enforcement. */
export interface Config {
  /** Non-bookkeeping attempts after which one reminder is injected. */
  reminderAfterCalls: number
  /** Maximum non-bookkeeping attempts before later calls are denied. */
  blockAfterCalls: number
}

/** Loader validation; both values are required deployment choices. */
export const Config: z<Config> = z.object({
  reminderAfterCalls: z.number().required(),
  blockAfterCalls: z.number().required(),
})

/** One active todo epoch. Replacing the list replaces this object and invalidates pending reminders. */
interface FreshnessState {
  calls: number
}

/** Reminder reservation retained from admission until the call reaches post-execute. */
interface ReminderReservation {
  state: FreshnessState
  calls: number
  session: Session
}

const TODO_TOOL = 'todo_write'
/**
 * Reminder attribution. Session format 4 (Host 0.1.7) refuses the shared
 * `{ kind: 'plugin' }` wrapper, and its V3-to-V4 migration rewrites this
 * guard's earlier reminders to `plugin:todo-freshness-guard`, so new reminders
 * carry that same kind. Hosts writing format 3 or older keep the wrapper: the
 * V2-to-V3 migration their logs still pass through admits only known kinds.
 */
const PLUGIN_SOURCE = SESSION_FORMAT_VERSION >= 4
  ? { kind: 'plugin:todo-freshness-guard' as const }
  : { kind: 'plugin' as const, plugin: 'todo-freshness-guard' }

/** Whether a whole list still represents unfinished work. */
function active(todos: readonly TodoItem[]): boolean {
  return todos.some(todo => todo.status !== 'completed')
}

/** The Session log reader each supported Host exposes: exactly one of the two. */
interface SessionLogReader {
  /** Host rc.6 through 0.1.2-alpha.3. */
  readonly events?: readonly SessionEvent[]
  /** Host 0.1.2-alpha.4 and later. */
  snapshotEvents?(): readonly SessionEvent[]
}

/**
 * Read the accepted Session log on every supported Host. A Host offering
 * neither reader yields no history, which leaves enforcement off until the
 * next `todo_write` or turn start instead of failing the tool call.
 */
function sessionEvents(session: Session): readonly SessionEvent[] {
  const reader = session as unknown as SessionLogReader
  return reader.snapshotEvents?.() ?? reader.events ?? []
}

/**
 * Recover the current turn's latest todo list when this plugin mounts, or
 * remounts after a configuration change, after the relevant events were already
 * appended. A turn start bounds the projection, matching the todo projection's
 * own reset rule.
 */
function currentTodos(events: readonly SessionEvent[]): readonly TodoItem[] | undefined {
  for (const event of events.toReversed()) {
    if (event.type === 'todo/write') return event.data.todos
    if (event.type === 'turn/start') return undefined
  }
  return undefined
}

/** Validate direct construction as well as Loader-validated configuration. */
function thresholds(config: Config): { reminder: number; block: number } {
  const reminder = config.reminderAfterCalls
  const block = config.blockAfterCalls
  if (!Number.isInteger(reminder) || reminder < 1) {
    throw new Error(`todo-freshness-guard: invalid reminderAfterCalls ${reminder} — must be an integer >= 1`)
  }
  if (!Number.isInteger(block) || block <= reminder) {
    throw new Error(`todo-freshness-guard: invalid blockAfterCalls ${block} — must be an integer greater than reminderAfterCalls`)
  }
  return { reminder, block }
}

/** Stable model-visible reminder injected after the configured advisory threshold. */
function reminder(calls: number): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Task status is stale: ${calls} non-bookkeeping tool calls have run since the latest todo_write. `
        + 'Reconcile the complete task list now: mark finished items completed, mark every active item in_progress, '
        + 'and call todo_write before continuing.',
    }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: `Todo status stale after ${calls} calls` },
  })
}

/** Preserve downstream post-execute decisions while prepending one reminder. */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/**
 * Install per-session admission counters and reminder delivery.
 * @param ctx - plugin context carrying the tool execution waterfalls.
 * @param config - required reminder and blocking thresholds.
 */
export function apply(ctx: Context, config: Config): void {
  const { reminder: reminderThreshold, block: blockThreshold } = thresholds(config)
  const states = new WeakMap<Session, FreshnessState>()
  const initialized = new WeakSet<Session>()
  const reminders = new WeakMap<ToolExecution, ReminderReservation>()

  function reset(session: Session, todos: readonly TodoItem[] | undefined): void {
    initialized.add(session)
    if (todos !== undefined && active(todos)) states.set(session, { calls: 0 })
    else states.delete(session)
  }

  function stateOf(agent: Agent): FreshnessState | undefined {
    const session = agent.session
    if (!initialized.has(session)) reset(session, currentTodos(sessionEvents(session)))
    return states.get(session)
  }

  // Event ownership is authoritative: every successful todo_write replaces the
  // epoch even when the list values are identical, while a new turn clears it.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'todo/write') reset(session, event.data.todos)
    else if (event.type === 'turn/start') reset(session, undefined)
  })

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!exec.agent) return next()
    // todo_write must remain reachable under enforcement. The Code Mode outer
    // transport is equally exempt; its parented SDK calls carry the real work.
    if (exec.name === TODO_TOOL || (exec.name === RUN_CODE_NAME && exec.parent === undefined)) return next()
    const state = stateOf(exec.agent)
    if (!state) return next()
    if (state.calls >= blockThreshold) {
      return {
        kind: 'deny',
        reason: `task status is stale after ${state.calls} tool calls since the latest todo_write; `
          + 'call todo_write with the complete reconciled list before using another tool',
      }
    }
    state.calls++
    if (state.calls === reminderThreshold) {
      reminders.set(exec, { state, calls: state.calls, session: exec.agent.session })
    }
    return next()
  })

  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const downstream = await next()
    const reservation = reminders.get(exec)
    if (!reservation) return downstream
    // A concurrent todo_write replaced the epoch while this call was running;
    // its newer snapshot makes the reserved reminder obsolete.
    if (states.get(reservation.session) !== reservation.state) return downstream
    const context = reminder(reservation.calls)
    if (downstream.kind === 'block') {
      return {
        kind: 'block',
        feedback: downstream.feedback,
        additionalContexts: prependContext(context, downstream.additionalContexts),
      }
    }
    return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
  })
}
