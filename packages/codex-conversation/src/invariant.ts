/** Package-owned invariant companion for the Side Chat UI plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-codex-conversation'

/** Cordis companion name. */
export const name = 'client-ui-side-chat-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** Slot and controller ownership are fully represented by the plugin fiber. */
const install: InvariantInstaller = () => {
  // No runtime invariant: SlotRegistry and controller lifecycle tests own this client-only boundary.
}

/** Register package ownership with the invariant registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
