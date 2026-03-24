import { describe, expect, it } from 'vitest';
import { choiceLabel, nextChoice, parseChoice, resolveTheme } from './theme';

describe('parseChoice', () => {
  it('既知の値はそのまま通す', () => {
    expect(parseChoice('light')).toBe('light');
    expect(parseChoice('dark')).toBe('dark');
    expect(parseChoice('system')).toBe('system');
  });

  it('未知やnullは system に倒す', () => {
    expect(parseChoice(null)).toBe('system');
    expect(parseChoice(undefined)).toBe('system');
    expect(parseChoice('bogus')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('system はシステム設定に従う', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('明示の選択はシステム設定を無視する', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('nextChoice', () => {
  it('自動→ライト→ダーク→自動 を巡回する', () => {
    expect(nextChoice('system')).toBe('light');
    expect(nextChoice('light')).toBe('dark');
    expect(nextChoice('dark')).toBe('system');
  });
});

describe('choiceLabel', () => {
  it('日本語ラベルを返す', () => {
    expect(choiceLabel('system')).toBe('自動');
    expect(choiceLabel('light')).toBe('ライト');
    expect(choiceLabel('dark')).toBe('ダーク');
  });
});
