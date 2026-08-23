import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationBodyProps } from './slots.ts'
import css from './AnnotationBody.module.css'

/**
 * Present one sent annotation batch as numbered quote cards instead of the
 * literal attachment text. Each card links back to the answer its passage was
 * selected from; the user's own request follows the cards as plain text.
 * @param props - The parsed attachment elected by this entry's selector.
 * @returns The annotated user-bubble body.
 */
export function AnnotationBody({ matched, t }: AnnotationBodyProps) {
  return (
    <div className={css.root} data-annotation-body>
      <ol className={css.cards}>
        {matched.items.map((item, index) => (
          <li key={index} className={css.card}>
            <a
              className={css.quote}
              href={`#dsh-message-${String(item.seq)}`}
              aria-label={`${t('selection.annotation')} ${String(index + 1)}`}
              data-answer-annotation={item.seq}
              data-annotation-index={index + 1}
              onClick={(event) => {
                event.preventDefault()
                window.location.hash = `dsh-message-${String(item.seq)}`
              }}
            >
              <span className={css.ordinal} aria-hidden>{index + 1}</span>
              <span className={css.quoteText}>{item.text}</span>
            </a>
            {item.annotation !== null && (
              <div className={css.comment}>
                <span className={css.commentLabel}>{t('annotation.comment')}</span>
                <MessageText text={item.annotation} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {matched.request !== '' && (
        <div className={css.request} data-annotation-request>
          <MessageText text={matched.request} />
        </div>
      )}
    </div>
  )
}
