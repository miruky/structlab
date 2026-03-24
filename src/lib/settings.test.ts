import { describe, expect, it } from 'vitest';
import { intervalFor, parseSpeed, SPEEDS, SPEED_LABELS } from './settings';

describe('parseSpeed', () => {
  it('既知の段階はそのまま通す', () => {
    expect(parseSpeed('slow')).toBe('slow');
    expect(parseSpeed('normal')).toBe('normal');
    expect(parseSpeed('fast')).toBe('fast');
  });

  it('未知やnullは normal に倒す', () => {
    expect(parseSpeed(null)).toBe('normal');
    expect(parseSpeed('turbo')).toBe('normal');
  });
});

describe('intervalFor', () => {
  it('速いほど間隔が短い', () => {
    expect(intervalFor('fast')).toBeLessThan(intervalFor('normal'));
    expect(intervalFor('normal')).toBeLessThan(intervalFor('slow'));
  });

  it('すべての段階にラベルと正の間隔がある', () => {
    for (const speed of SPEEDS) {
      expect(SPEED_LABELS[speed].length).toBeGreaterThan(0);
      expect(intervalFor(speed)).toBeGreaterThan(0);
    }
  });
});
