import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { arcSolid, sectorLathe } from './shapes';

function bounds(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('arcSolid', () => {
  it('sits on y=0 and rises to the requested height', () => {
    const g = arcSolid(0.02, 0.03, 0.05, 0, 90);
    const b = bounds(g);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(b.max.y).toBeCloseTo(0.05, 5);
  });

  it('keeps a full ring inside the outer radius', () => {
    const g = arcSolid(0.02, 0.03, 0.01, 0, 360);
    const b = bounds(g);
    expect(b.max.x).toBeCloseTo(0.03, 3);
    expect(b.min.x).toBeCloseTo(-0.03, 3);
    expect(b.max.z).toBeCloseTo(0.03, 3);
  });

  it('places a narrow sector on the CAD azimuth it was given', () => {
    // CAD 270 deg is +Z under the render frame convention.
    const g = arcSolid(0.02, 0.03, 0.01, 265, 275);
    const b = bounds(g);
    expect(b.min.z).toBeGreaterThan(0.015);
    expect(Math.abs(b.max.x)).toBeLessThan(0.006);
  });

  it('produces non-empty indexed geometry', () => {
    const g = arcSolid(0.02, 0.03, 0.01, 0, 45);
    expect(g.getAttribute('position').count).toBeGreaterThan(0);
    expect(g.index).not.toBeNull();
  });
});

describe('sectorLathe', () => {
  it('spans the profile radii and heights', () => {
    const g = sectorLathe([[0.01, 0], [0.02, 0.1]], 0, 360);
    const b = bounds(g);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(b.max.y).toBeCloseTo(0.1, 5);
    expect(b.max.x).toBeCloseTo(0.02, 3);
  });

  it('sweeps only the requested span', () => {
    const g = sectorLathe([[0.02, 0], [0.02, 0.01]], 265, 275);
    const b = bounds(g);
    expect(b.min.z).toBeGreaterThan(0.015);
  });
});
