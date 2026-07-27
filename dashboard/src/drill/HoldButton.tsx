// Hold-to-move button. Pressed state is the control's only accent; a gated
// button renders disabled with a one-line muted reason instead of failing silently.
import { useHoldCommand } from '../useHoldCommand';
import styles from './HoldButton.module.css';

export type HoldButtonProps = {
  label: string;
  /** Encoded command re-published while held. */
  makeCmd: () => Uint8Array;
  /** Encoded zero of the same command, sent once on release. */
  makeZero: () => Uint8Array;
  halted: boolean;
  disabled?: boolean;
  /** Muted hint shown under a disabled button, e.g. "uncalibrated". */
  reason?: string;
  testId?: string;
  className?: string;
};

export function HoldButton({
  label,
  makeCmd,
  makeZero,
  halted,
  disabled = false,
  reason,
  testId,
  className,
}: HoldButtonProps) {
  const { active, handlers } = useHoldCommand({ makeCmd, makeZero, halted, disabled });
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.btn}
        aria-pressed={active}
        disabled={disabled}
        data-testid={testId}
        {...handlers}
      >
        {label}
      </button>
      {disabled && reason ? <span className={styles.reason}>{reason}</span> : null}
    </div>
  );
}
