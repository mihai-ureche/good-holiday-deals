import { useEffect, useRef, type ReactNode } from 'react';
import './messages.css';

export function FullWindowDialog({ titleId, descriptionId, error = false, className = '', children, onDismiss }: {
  titleId: string; descriptionId?: string; error?: boolean; className?: string;
  children: ReactNode; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const pageOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.documentElement.style.overflow = pageOverflow;
      document.body.style.overflow = bodyOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className={`message-modal${error ? ' message-modal-error' : ''} ${className}`}
    role={error ? 'alertdialog' : 'dialog'} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <button type="button" className="message-close" aria-label="Close dialog" onClick={onDismiss}>×</button>
    {children}
  </dialog>;
}
