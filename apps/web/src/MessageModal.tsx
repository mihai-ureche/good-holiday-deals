import { useId } from 'react';
import { FullWindowDialog } from './FullWindowDialog.js';

export function MessageModal({ message, error = false, onDismiss }: {
  message: string; error?: boolean; onDismiss: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  return <FullWindowDialog titleId={titleId} descriptionId={descriptionId} error={error} onDismiss={onDismiss}>
    <div className="message-content">
      <p className="eyebrow">GOOD HOLIDAY DEALS</p>
      <span className="message-icon" aria-hidden="true">{error ? '!' : '✓'}</span>
      <h2 id={titleId}>{error ? 'Something went wrong.' : 'All set.'}</h2>
      <p id={descriptionId} className="message-text">{message}</p>
      <button type="button" className="primary" autoFocus onClick={onDismiss}>{error ? 'Close' : 'Got it →'}</button>
    </div>
  </FullWindowDialog>;
}
