// Shared render stage for the panel hero card and the teleop window: the 3D
// scene or the 2D elevation, an operator toggle between them, and the honesty
// hints that belong to the render itself (unknown height, indicative switch
// rotation). A scene that fails to render falls back to the schematic instead
// of leaving an empty stage.
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { AugerDirection } from '../proto/drill_pb';
import { DrillScene, type DrillPose } from './DrillScene';
import { Drill2DScene } from './Drill2DScene';
import styles from './DrillViewport.module.css';

export type { DrillPose };

export type ViewMode = '3d' | '2d';

const MODES: ViewMode[] = ['3d', '2d'];

class SceneBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') {
      console.warn('[drill3d] scene failed, falling back to 2d', err, info.componentStack);
    }
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function DrillViewport({ pose, variant }: { pose: DrillPose; variant: 'hero' | 'compact' }) {
  const [mode, setMode] = useState<ViewMode>('3d');
  const [sceneFailed, setSceneFailed] = useState(false);

  const flat = sceneFailed || mode === '2d';
  const naReason = pose.heightNorm == null
    ? (pose.heightNaReason?.trim() || 'reason not reported')
    : null;

  return (
    <div className={styles.viewport} data-variant={variant} data-testid="drill-viewport">
      {flat ? (
        <Drill2DScene pose={pose} />
      ) : (
        <SceneBoundary onError={() => setSceneFailed(true)}>
          <DrillScene pose={pose} variant={variant} />
        </SceneBoundary>
      )}

      <span className={styles.tag}>
        {flat ? '2d · side elevation' : '3d · drag to orbit'}
      </span>

      <div className={styles.modeRow}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={styles.vpBtn}
            aria-pressed={flat ? m === '2d' : m === mode}
            disabled={sceneFailed && m === '3d'}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <div className={styles.hints}>
        {sceneFailed ? (
          <span className={styles.hint}>3d render unavailable, showing the schematic</span>
        ) : null}
        {naReason ? (
          <span className={styles.hint} data-testid="viewport-height-na">
            height N/A · {naReason}
          </span>
        ) : null}
        {pose.augerDirection === AugerDirection.SWITCH ? (
          <span className={styles.hint} data-testid="viewport-switch-hint">
            switch rotation indicative (not measured)
          </span>
        ) : null}
        {pose.halted ? <span className={styles.hint}>halted, render frozen</span> : null}
      </div>
    </div>
  );
}
