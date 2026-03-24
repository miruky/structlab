// テーマ(自動 / ライト / ダーク)の純粋ロジック。DOMやlocalStorageには触れず、
// 値の解決だけを行うのでテストしやすい。適用とFOUC回避は app.ts と index.html が担う。

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'structlab:theme';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

/** 保存値を安全に ThemeChoice へ。未知の値は 'system' に倒す。 */
export function parseChoice(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** 選択とシステム設定から、実際に当てる light / dark を決める。 */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

/** トグルの巡回。自動 → ライト → ダーク → 自動。 */
export function nextChoice(choice: ThemeChoice): ThemeChoice {
  const i = ORDER.indexOf(choice);
  return ORDER[(i + 1) % ORDER.length] as ThemeChoice;
}

/** ボタンの読み上げ・表示に使うラベル。 */
export function choiceLabel(choice: ThemeChoice): string {
  return choice === 'system' ? '自動' : choice === 'light' ? 'ライト' : 'ダーク';
}
