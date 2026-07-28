import { describe, it, expect } from 'vitest';
import { AugerDirection } from '../proto/drill_pb';
import { BARREL, HOPPER } from './geometry';
import { elevationBounds } from './Drill2DScene';

describe('elevationBounds', () => {
  it('frames the hopper at the bottom and the raised cap at the top', () => {
    const b = elevationBounds();
    expect(b.yMin).toBeLessThanOrEqual(HOPPER.y0);
    expect(b.yMax).toBeGreaterThan(BARREL.h);
  });

  it('frames the hopper outer radius, the widest feature', () => {
    expect(elevationBounds().xHalf).toBeGreaterThanOrEqual(HOPPER.outerR);
  });
});

describe('Drill2DScene', () => {
  it('renders a canvas for every direction without throwing', async () => {
    const { Drill2DScene } = await import('./Drill2DScene');
    const { render } = await import('@testing-library/react');
    for (const d of [AugerDirection.IDLE, AugerDirection.DRILL, AugerDirection.SWITCH]) {
      const { container, unmount } = render(
        <Drill2DScene pose={{
          heightNorm: 0.5, heightNaReason: null,
          augerDirection: d, augerVelocityRaw: 500, halted: false,
        }} />,
      );
      expect(container.querySelector('[data-drill-2d]')).toBeTruthy();
      unmount();
    }
  });

  it('renders with an unknown height', async () => {
    const { Drill2DScene } = await import('./Drill2DScene');
    const { render } = await import('@testing-library/react');
    const { container } = render(
      <Drill2DScene pose={{
        heightNorm: null, heightNaReason: 'not homed',
        augerDirection: AugerDirection.IDLE, augerVelocityRaw: null, halted: false,
      }} />,
    );
    expect(container.querySelector('[data-drill-2d]')).toBeTruthy();
  });
});
