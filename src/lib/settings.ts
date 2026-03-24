// 再生速度の設定。イベント列を1ステップずつ流す間隔を3段階で選べる。
// 値の解釈はここに集約してテストし、保存と適用は app.ts が担う。

export type Speed = 'slow' | 'normal' | 'fast';

export const SPEED_STORAGE_KEY = 'structlab:speed';

const INTERVALS: Record<Speed, number> = { slow: 460, normal: 260, fast: 120 };

export const SPEED_LABELS: Record<Speed, string> = {
  slow: '遅い',
  normal: '標準',
  fast: '速い',
};

export const SPEEDS: Speed[] = ['slow', 'normal', 'fast'];

/** 保存値を安全に Speed へ。未知の値は 'normal' に倒す。 */
export function parseSpeed(value: string | null | undefined): Speed {
  return value === 'slow' || value === 'normal' || value === 'fast' ? value : 'normal';
}

/** 段階に対応する1ステップの間隔(ミリ秒)。 */
export function intervalFor(speed: Speed): number {
  return INTERVALS[speed];
}
