/**
 * One line of a conversation's timeline for an answer, a judgement or a request. The full text stays in the document at the
 * question or card; `onJump` offers the way back to it. Shared by the home scene lesson, the story lesson and the cards lesson.
 */
export function EventLine({ text, questionId, jumpLabel, onJump }: { text: string; questionId: string; jumpLabel?: string; onJump?: () => void }) {
  return <p className="lw-event-line" data-summary-of={questionId}><span>{text}</span>{onJump && <button type="button" onClick={onJump}>{jumpLabel}</button>}</p>;
}
