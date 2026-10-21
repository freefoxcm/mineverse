import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_COUNT, faceTexture, getBlockDef, IS_OPAQUE, blockNumeric } from '../../src/world/blocks';

describe('block registry', () => {
  it('assigns unique numeric ids', () => {
    const ids = new Set<number>();
    for (let i = 0; i < BLOCK_COUNT; i++) ids.add(getBlockDef(i).numeric);
    expect(ids.size).toBe(BLOCK_COUNT);
    expect(getBlockDef(0).id).toBe('air');
  });

  it('resolves ids by name', () => {
    expect(blockNumeric('stone')).toBe(getBlockDef(blockNumeric('stone')).numeric);
    expect(blockNumeric('nonexistent')).toBe(0);
    expect(BLOCK.stone).not.toBe(BLOCK.air);
  });

  it('marks air and plants as non-opaque', () => {
    expect(IS_OPAQUE[BLOCK.air]).toBe(0);
    expect(IS_OPAQUE[BLOCK.stone]).toBe(1);
    expect(IS_OPAQUE[blockNumeric('tall_grass')]).toBe(0);
  });

  it('maps faces to texture tiles', () => {
    const grass = getBlockDef(BLOCK.grass_block);
    expect(faceTexture(grass, 2)).toBe('grass_top');
    expect(faceTexture(grass, 3)).toBe('dirt');
    const log = getBlockDef(BLOCK.oak_log);
    expect(faceTexture(log, 2)).toBe('oak_log_top');
    expect(faceTexture(log, 0)).toBe('oak_log');
  });

  it('keeps numeric ids below 256', () => {
    expect(BLOCK_COUNT).toBeLessThan(256);
  });
});
