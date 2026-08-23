import { IconNewChatOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideChatActionProps } from './slots.ts'
import css from './SideChatAction.module.css'

/** Whole-answer entry in the assistant action strip. */
export function SideChatAction({ seq, text, open, t }: SideChatActionProps) {
  const label = t('action.open')
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={label}
        onClick={() => { open({ seq, text }) }}
      >
        <IconNewChatOutline16 />
      </button>
    </Tooltip>
  )
}
