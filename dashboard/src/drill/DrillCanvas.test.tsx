import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DrillCanvas } from './DrillCanvas';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="canvas">{children}</div>,
  useFrame: () => {},
  useThree: (sel: (s: unknown) => unknown) =>
    sel({ invalidate: () => {}, gl: { domElement: document.createElement('canvas') }, camera: { lookAt: () => {} } }),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

describe('DrillCanvas', () => {
  it('renders its children inside a canvas', () => {
    const { getByTestId } = render(
      <DrillCanvas variant="hero"><mesh data-testid="child" /></DrillCanvas>,
    );
    expect(getByTestId('canvas')).toBeTruthy();
  });

  it('accepts the compact variant', () => {
    const { getByTestId } = render(
      <DrillCanvas variant="compact"><mesh /></DrillCanvas>,
    );
    expect(getByTestId('canvas')).toBeTruthy();
  });
});
