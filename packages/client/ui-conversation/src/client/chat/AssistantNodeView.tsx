import { memo, useMemo } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './AssistantNodeView.module.css'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'>
  & PropsRenderSlots<'conversation.chat.assistant-body-overlay'>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, renderSlot, t,
}: AssistantNodeViewProps) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn === undefined || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const messageId = data.finalNode?.messageId
  const body = (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
    />
  )
  const annotatable = owner !== undefined && messageId !== undefined && data.status === 'settled'
  return (
    <div
      id={annotatable ? `dsh-message-${String(owner.seq)}` : undefined}
      className={css.root}
      data-assistant-message-body={annotatable || undefined}
    >
      {body}
      {annotatable && renderSlot('conversation.chat.assistant-body-overlay', {
        messageId,
        seq: owner.seq,
        text: assistantText(data.blocks),
      })}
    </div>
  )
})
