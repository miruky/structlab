// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountApp } from './app';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  mountApp(root);
  return root;
}

function panelOf(root: HTMLElement, id: string): HTMLElement {
  return root.querySelector(`#${id}`) as HTMLElement;
}

function clickAction(panel: HTMLElement, action: string): void {
  (panel.querySelector(`button[data-act="${action}"]`) as HTMLButtonElement).click();
}

describe('mountApp', () => {
  let root: HTMLElement;

  beforeEach(() => {
    location.hash = '';
    root = mount();
  });

  it('2つのタブと初期データ入りのB木が描画される', () => {
    expect(root.querySelectorAll('[role="tab"]').length).toBe(2);
    expect(root.querySelectorAll('g.bt-node').length).toBeGreaterThan(0);
    const stats = panelOf(root, 'panel-btree').querySelector('.stats');
    expect(stats?.textContent).toContain('キー数 12');
  });

  it('タブ切替でパネルの表示が入れ替わる', () => {
    const hashTab = root.querySelector('#tab-hash') as HTMLButtonElement;
    hashTab.click();
    expect(panelOf(root, 'panel-btree').hidden).toBe(true);
    expect(panelOf(root, 'panel-hash').hidden).toBe(false);
    expect(hashTab.getAttribute('aria-selected')).toBe('true');
  });

  it('URLの#hashでハッシュテーブルタブが開く', () => {
    location.hash = '#hash';
    root = mount();
    expect(panelOf(root, 'panel-hash').hidden).toBe(false);
    expect(panelOf(root, 'panel-btree').hidden).toBe(true);
  });
});

describe('B木パネル', () => {
  let panel: HTMLElement;

  beforeEach(() => {
    location.hash = '';
    panel = panelOf(mount(), 'panel-btree');
  });

  it('挿入でキー数が増え、ログに記録される', () => {
    (panel.querySelector('input') as HTMLInputElement).value = '500';
    clickAction(panel, 'insert');
    expect(panel.querySelector('.stats')?.textContent).toContain('キー数 13');
    expect(panel.querySelector('.log-list')?.textContent).toContain('挿入 500');
  });

  it('削除でキー数が減る', () => {
    (panel.querySelector('input') as HTMLInputElement).value = '42';
    clickAction(panel, 'delete');
    expect(panel.querySelector('.stats')?.textContent).toContain('キー数 11');
  });

  it('範囲外の入力はaria-invalidになり木を変えない', () => {
    const input = panel.querySelector('input') as HTMLInputElement;
    input.value = '5000';
    clickAction(panel, 'insert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(panel.querySelector('.stats')?.textContent).toContain('キー数 12');
  });

  it('全消去で空のB木に戻る', () => {
    clickAction(panel, 'clear');
    expect(panel.querySelector('.stats')?.textContent).toContain('キー数 0');
    expect(panel.querySelectorAll('g.bt-node').length).toBe(1);
  });

  it('最小次数の変更で同じキー集合のまま木が作り直される', () => {
    const select = panel.querySelector('select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    const stats = panel.querySelector('.stats')?.textContent ?? '';
    expect(stats).toContain('キー数 12');
    expect(stats).toContain('1ノードのキー数 2〜5');
  });
});

describe('ハッシュテーブルパネル', () => {
  let panel: HTMLElement;

  beforeEach(() => {
    location.hash = '';
    panel = panelOf(mount(), 'panel-hash');
  });

  it('挿入で要素数が増え、ハッシュ値の読み出しが表示される', async () => {
    (panel.querySelector('input') as HTMLInputElement).value = 'wakaba';
    clickAction(panel, 'insert');
    expect(panel.querySelector('.stats')?.textContent).toContain('要素数 6');
    // 読み出しはイベント再生の先頭ステップ(遅延0ms)で書かれる
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.querySelector('.readout')?.textContent).toContain('fnv1a("wakaba")');
  });

  it('方式の切替で同じキー集合のまま作り直される', () => {
    const select = panel.querySelector('select') as HTMLSelectElement;
    select.value = 'linear';
    select.dispatchEvent(new Event('change'));
    expect(panel.querySelector('.stats')?.textContent).toContain('要素数 5');
    expect(panel.querySelectorAll('g.hb-cell[data-slot]').length).toBeGreaterThan(0);
  });

  it('空文字の挿入はaria-invalidになる', () => {
    const input = panel.querySelector('input') as HTMLInputElement;
    input.value = '   ';
    clickAction(panel, 'insert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(panel.querySelector('.stats')?.textContent).toContain('要素数 5');
  });

  it('二次走査法へ切り替えてもキー集合を保つ', () => {
    const select = panel.querySelector('select') as HTMLSelectElement;
    select.value = 'quadratic';
    select.dispatchEvent(new Event('change'));
    expect(panel.querySelector('.stats')?.textContent).toContain('要素数 5');
    expect(panel.querySelectorAll('g.hb-cell[data-slot]').length).toBeGreaterThan(0);
    expect(panel.querySelector('.log-list')?.textContent).toContain('二次走査法');
  });
});

describe('ツールと凡例', () => {
  beforeEach(() => {
    location.hash = '';
    // 保存値の有無に左右されないよう、可能なら設定を消してから始める
    try {
      localStorage.removeItem('structlab:theme');
      localStorage.removeItem('structlab:speed');
    } catch {
      /* localStorage非対応の環境では既定値で進む */
    }
  });

  it('ハイライトの凡例が両パネルに表示される', () => {
    const root = mount();
    expect(panelOf(root, 'panel-btree').querySelector('.legend')).not.toBeNull();
    expect(panelOf(root, 'panel-hash').querySelector('.legend')).not.toBeNull();
  });

  it('テーマトグルは自動→ライト→ダークと巡回し、html要素へ反映する', () => {
    const root = mount();
    const toggle = root.querySelector('#theme-toggle') as HTMLButtonElement;
    expect(toggle.dataset.choice).toBe('system');
    toggle.click();
    expect(toggle.dataset.choice).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    toggle.click();
    expect(toggle.dataset.choice).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('再生速度の選択肢が3段階そろう', () => {
    const speed = mount().querySelector('#speed-select') as HTMLSelectElement;
    expect(speed.querySelectorAll('option').length).toBe(3);
  });
});
