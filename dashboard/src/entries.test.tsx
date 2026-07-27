import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import panel from './mount';
import teleop from './teleop';
import { DrillState } from './proto/drill_pb';

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    roverId: 'r1',
    subscribe: vi.fn(() => () => {}),
    publish: vi.fn(),
    ...overrides,
  };
}

function mountInto(entry: { mount(el: HTMLElement, ctx: never): () => void }, ctx: unknown) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let teardown: () => void = () => {};
  act(() => {
    teardown = entry.mount(container, ctx as never);
  });
  return { container, teardown };
}

describe('module entries', () => {
  it('mounts the panel entry and unmounts cleanly', () => {
    const { container, teardown } = mountInto(panel, fakeCtx());
    expect(container.childElementCount).toBeGreaterThan(0);
    act(() => teardown());
    expect(container.childElementCount).toBe(0);
  });

  it('mounts the teleop entry without a publish channel', () => {
    const { publish: _publish, ...ctx } = fakeCtx();
    const { container, teardown } = mountInto(teleop, ctx);
    expect(container.childElementCount).toBeGreaterThan(0);
    act(() => teardown());
  });

  it('round-trips a DrillState through the copied proto bindings', () => {
    const bytes = new DrillState({ phase: 'idle', heightNorm: 0.25 }).toBinary();
    const back = DrillState.fromBinary(bytes);
    expect(back.phase).toBe('idle');
    expect(back.heightNorm).toBe(0.25);
  });
});
