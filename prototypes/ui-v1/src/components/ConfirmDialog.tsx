import { useEffect, useRef } from 'react';

export interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  value,
  onClose,
}: {
  value: Confirmation | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (value) ref.current?.showModal();
    else ref.current?.close();
  }, [value]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="confirm-title"
    >
      <h2 id="confirm-title">{value?.title}</h2>
      <p>{value?.message}</p>
      <div>
        <button className="secondary-button" onClick={onClose}>
          取消
        </button>
        <button
          className="primary-button"
          onClick={() => {
            value?.onConfirm();
            onClose();
          }}
        >
          {value?.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
