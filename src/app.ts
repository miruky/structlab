import { BTree, type BTreeEvent } from './lib/btree';
import { HashTable, type HashEvent, type HashStrategy } from './lib/hashtable';
import { layoutTree, DEFAULT_LAYOUT } from './lib/treelayout';
import {
  THEME_STORAGE_KEY,
  choiceLabel,
  nextChoice,
  parseChoice,
  resolveTheme,
  type ThemeChoice,
} from './lib/theme';
import {
  SPEEDS,
  SPEED_LABELS,
  SPEED_STORAGE_KEY,
  intervalFor,
  parseSpeed,
  type Speed,
} from './lib/settings';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 再生間隔は速度設定で動かす。両ビューが同じ値を参照する。
let currentInterval = intervalFor('normal');

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  return element;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ハイライトの色語彙はB木・ハッシュで共通。各ビューの下に凡例を添える。
const LEGEND = `
  <ul class="legend" aria-label="ハイライトの凡例">
    <li><span class="sw sw-visit"></span>通過・走査</li>
    <li><span class="sw sw-new"></span>新規</li>
    <li><span class="sw sw-found"></span>発見</li>
    <li><span class="sw sw-warn"></span>衝突・重複</li>
    <li><span class="sw sw-change"></span>変化</li>
  </ul>`;

// イベント列を一定間隔で再生する。新しい操作が始まったら前の再生を打ち切る。
class Sequencer {
  private timers: number[] = [];

  cancel(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
  }

  play(steps: (() => void)[], interval: number): void {
    this.cancel();
    if (prefersReducedMotion() || interval <= 0) {
      for (const step of steps) step();
      return;
    }
    steps.forEach((step, i) => {
      this.timers.push(window.setTimeout(step, i * interval));
    });
  }
}

interface LogEntry {
  title: string;
  lines: string[];
}

class OperationLog {
  private entries: LogEntry[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly limit = 30,
  ) {}

  add(title: string, lines: string[]): void {
    this.entries.unshift({ title, lines });
    if (this.entries.length > this.limit) this.entries.pop();
    this.render();
  }

  clear(): void {
    this.entries = [];
    this.render();
  }

  private render(): void {
    this.container.replaceChildren(
      ...this.entries.map((entry, i) => {
        const item = document.createElement('article');
        item.className = 'log-entry';
        if (i === 0) item.classList.add('log-entry-new');
        const heading = document.createElement('h4');
        heading.textContent = entry.title;
        item.append(heading);
        const list = document.createElement('ol');
        for (const line of entry.lines) {
          const li = document.createElement('li');
          li.textContent = line;
          list.append(li);
        }
        item.append(list);
        return item;
      }),
    );
  }
}

const PADDING = 14;

function describeBTreeEvent(event: BTreeEvent): string {
  switch (event.type) {
    case 'visit':
      return event.keys.length > 0 ? `[${event.keys.join(' ')}] を通過` : '空の根を通過';
    case 'found':
      return `キー ${event.key} を発見`;
    case 'not-found':
      return `キー ${event.key} は存在しない`;
    case 'duplicate':
      return `キー ${event.key} は既に存在する`;
    case 'insert-key':
      return `キー ${event.key} を葉に挿入`;
    case 'remove-key':
      return `キー ${event.key} を取り除く`;
    case 'replace-key':
      return `内部のキー ${event.oldKey} を ${event.newKey} で置き換え、続きは子で削除`;
    case 'split':
      return `満杯のノードを分割し、中央キー ${event.middleKey} を親へ持ち上げ`;
    case 'new-root':
      return '根が満杯のため新しい根を用意';
    case 'borrow':
      return `兄弟からキーを借用(${event.upKey} が親へ上がり ${event.downKey} が降りる)`;
    case 'merge':
      return `キー不足のノードを統合し、親キー ${event.downKey} を取り込み`;
    case 'shrink-root':
      return '根が空になり、木の高さが1減少';
  }
}

class BTreeView {
  private tree = new BTree(2);
  private insertionOrder: number[] = [];
  private readonly sequencer = new Sequencer();
  private prevPositions = new Map<number, { x: number; y: number }>();
  private prevEdges = new Set<string>();

  private readonly svg: SVGSVGElement;
  private readonly input: HTMLInputElement;
  private readonly degreeSelect: HTMLSelectElement;
  private readonly stats: HTMLElement;
  private readonly log: OperationLog;

  constructor(panel: HTMLElement) {
    panel.innerHTML = `
      <div class="workbench">
        <section class="viz-card">
          <div class="controls">
            <label class="field">キー
              <input type="number" min="0" max="999" step="1" value="42" aria-label="操作するキー" />
            </label>
            <button type="button" class="primary" data-act="insert">挿入</button>
            <button type="button" data-act="delete">削除</button>
            <button type="button" data-act="search">検索</button>
            <span class="controls-gap" role="presentation"></span>
            <button type="button" data-act="random">ランダム10件</button>
            <button type="button" data-act="clear">全消去</button>
            <label class="field">最小次数
              <select aria-label="B木の最小次数">
                <option value="2" selected>t = 2</option>
                <option value="3">t = 3</option>
              </select>
            </label>
          </div>
          <p class="stats" aria-live="polite"></p>
          <div class="canvas" tabindex="0" role="img" aria-label="B木の構造図"></div>
          ${LEGEND}
        </section>
        <aside class="log-card">
          <h3>操作ログ</h3>
          <div class="log-list" aria-live="polite"></div>
        </aside>
      </div>
    `;
    this.svg = svgEl('svg');
    panel.querySelector('.canvas')?.append(this.svg);
    this.input = panel.querySelector('input') as HTMLInputElement;
    this.degreeSelect = panel.querySelector('select') as HTMLSelectElement;
    this.stats = panel.querySelector('.stats') as HTMLElement;
    this.log = new OperationLog(panel.querySelector('.log-list') as HTMLElement);

    panel.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-act]');
      if (button) this.handle((button as HTMLElement).dataset.act ?? '');
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handle('insert');
    });
    this.degreeSelect.addEventListener('change', () => this.rebuild());

    this.seed();
    this.render();
  }

  private seed(): void {
    const sample = [42, 17, 88, 5, 63, 29, 71, 50, 96, 34, 11, 77];
    for (const key of sample) {
      this.tree.insert(key);
      this.insertionOrder.push(key);
    }
    this.log.add('初期データ', [`${sample.length} 個のキーを挿入: ${sample.join(', ')}`]);
  }

  private readKey(): number | null {
    const value = Number(this.input.value);
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      this.input.setAttribute('aria-invalid', 'true');
      this.input.focus();
      return null;
    }
    this.input.removeAttribute('aria-invalid');
    return value;
  }

  private handle(action: string): void {
    if (action === 'random') {
      const added: number[] = [];
      while (added.length < 10) {
        const key = Math.floor(Math.random() * 1000);
        if (this.tree.has(key)) continue;
        this.tree.insert(key);
        this.insertionOrder.push(key);
        added.push(key);
      }
      this.render();
      this.log.add(`ランダム挿入 (${added.length}件)`, [`追加: ${added.join(', ')}`]);
      return;
    }
    if (action === 'clear') {
      this.tree = new BTree(Number(this.degreeSelect.value));
      this.insertionOrder = [];
      this.prevPositions.clear();
      this.prevEdges.clear();
      this.render();
      this.log.add('全消去', ['空のB木に戻した']);
      return;
    }
    const key = this.readKey();
    if (key === null) return;
    let events: BTreeEvent[];
    let title: string;
    if (action === 'insert') {
      events = this.tree.insert(key);
      if (events.some((e) => e.type === 'insert-key')) this.insertionOrder.push(key);
      title = `挿入 ${key}`;
    } else if (action === 'delete') {
      events = this.tree.delete(key);
      if (events.some((e) => e.type === 'remove-key' || e.type === 'replace-key')) {
        this.insertionOrder = this.insertionOrder.filter((k) => k !== key);
      }
      title = `削除 ${key}`;
    } else {
      events = this.tree.search(key);
      title = `検索 ${key}`;
    }
    this.render();
    this.log.add(title, events.map(describeBTreeEvent));
    this.playEvents(events);
  }

  // 次数を変えたら、これまでの挿入順を同じ次数の新しい木で再現する
  private rebuild(): void {
    const degree = Number(this.degreeSelect.value);
    this.tree = new BTree(degree);
    for (const key of this.insertionOrder) this.tree.insert(key);
    this.prevPositions.clear();
    this.prevEdges.clear();
    this.render();
    this.log.add(`最小次数を t = ${degree} に変更`, [
      `${this.insertionOrder.length} 個のキーを同じ順序で挿入し直した`,
    ]);
  }

  private render(): void {
    const layout = layoutTree(this.tree.root);
    const width = layout.width + PADDING * 2;
    const height = layout.height + PADDING * 2;
    this.svg.setAttribute('viewBox', `${-PADDING} ${-PADDING} ${width} ${height}`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.replaceChildren();

    const animate = !prefersReducedMotion();
    const nextEdges = new Set<string>();
    for (const edge of layout.edges) {
      const id = `${edge.fromId}-${edge.toId}`;
      nextEdges.add(id);
      const line = svgEl('line', {
        class: 'bt-edge' + (animate && !this.prevEdges.has(id) ? ' bt-edge-enter' : ''),
        x1: String(edge.x1),
        y1: String(edge.y1),
        x2: String(edge.x2),
        y2: String(edge.y2),
      });
      this.svg.append(line);
    }

    const nextPositions = new Map<number, { x: number; y: number }>();
    const { keyWidth } = DEFAULT_LAYOUT;
    for (const node of layout.nodes) {
      nextPositions.set(node.id, { x: node.x, y: node.y });
      const group = svgEl('g', { class: 'bt-node', 'data-id': String(node.id) });
      const box = svgEl('rect', {
        class: 'bt-box' + (node.keys.length === 0 ? ' bt-box-empty' : ''),
        width: String(node.width),
        height: String(node.height),
        rx: '8',
      });
      group.append(box);
      node.keys.forEach((key, i) => {
        if (i > 0) {
          group.append(
            svgEl('line', {
              class: 'bt-separator',
              x1: String(i * keyWidth),
              y1: '5',
              x2: String(i * keyWidth),
              y2: String(node.height - 5),
            }),
          );
        }
        const cell = svgEl('g', { class: 'bt-key', 'data-key': String(key) });
        cell.append(
          svgEl('rect', {
            class: 'bt-key-bg',
            x: String(i * keyWidth + 2),
            y: '2',
            width: String(keyWidth - 4),
            height: String(node.height - 4),
            rx: '6',
          }),
        );
        const text = svgEl('text', {
          class: 'bt-key-text',
          x: String(i * keyWidth + keyWidth / 2),
          y: String(node.height / 2),
        });
        text.textContent = String(key);
        cell.append(text);
        group.append(cell);
      });

      const prev = this.prevPositions.get(node.id);
      if (animate && !prev) group.classList.add('bt-enter');
      const startX = animate && prev ? prev.x : node.x;
      const startY = animate && prev ? prev.y : node.y;
      group.style.transform = `translate(${startX}px, ${startY}px)`;
      this.svg.append(group);
      if (animate && prev && (prev.x !== node.x || prev.y !== node.y)) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            group.style.transform = `translate(${node.x}px, ${node.y}px)`;
          }),
        );
      } else {
        group.style.transform = `translate(${node.x}px, ${node.y}px)`;
      }
    }
    this.prevPositions = nextPositions;
    this.prevEdges = nextEdges;

    this.stats.textContent =
      `キー数 ${this.tree.size} / ノード数 ${this.tree.nodeCount()} / ` +
      `高さ ${this.tree.height()} / 1ノードのキー数 ${this.tree.minDegree - 1}〜${2 * this.tree.minDegree - 1}`;
  }

  private nodeEl(id: number): SVGGElement | null {
    return this.svg.querySelector(`g.bt-node[data-id="${id}"]`);
  }

  private keyEl(nodeId: number, key: number): SVGGElement | null {
    return this.svg.querySelector(`g.bt-node[data-id="${nodeId}"] g.bt-key[data-key="${key}"]`);
  }

  private playEvents(events: BTreeEvent[]): void {
    this.svg
      .querySelectorAll('.hl-visit, .hl-found, .hl-new, .hl-warn, .hl-change')
      .forEach((element) =>
        element.classList.remove('hl-visit', 'hl-found', 'hl-new', 'hl-warn', 'hl-change'),
      );
    const steps: (() => void)[] = [];
    for (const event of events) {
      steps.push(() => {
        switch (event.type) {
          case 'visit':
            this.nodeEl(event.nodeId)?.classList.add('hl-visit');
            break;
          case 'found':
            this.keyEl(event.nodeId, event.key)?.classList.add('hl-found');
            break;
          case 'duplicate':
            this.keyEl(event.nodeId, event.key)?.classList.add('hl-warn');
            break;
          case 'insert-key':
            this.keyEl(event.nodeId, event.key)?.classList.add('hl-new');
            break;
          case 'remove-key':
            this.nodeEl(event.nodeId)?.classList.add('hl-change');
            break;
          case 'replace-key':
            this.keyEl(event.nodeId, event.newKey)?.classList.add('hl-change');
            break;
          case 'split':
            this.nodeEl(event.leftId)?.classList.add('hl-change');
            this.nodeEl(event.rightId)?.classList.add('hl-change');
            this.keyEl(event.parentId, event.middleKey)?.classList.add('hl-new');
            break;
          case 'borrow':
            this.nodeEl(event.fromId)?.classList.add('hl-visit');
            this.nodeEl(event.toId)?.classList.add('hl-change');
            this.keyEl(event.parentId, event.upKey)?.classList.add('hl-change');
            break;
          case 'merge':
            this.nodeEl(event.leftId)?.classList.add('hl-change');
            break;
          case 'new-root':
          case 'shrink-root':
            this.nodeEl(event.nodeId)?.classList.add('hl-change');
            break;
          case 'not-found':
            break;
        }
      });
    }
    this.sequencer.play(steps, currentInterval);
  }
}

const STRATEGY_LABELS: Record<HashStrategy, string> = {
  chaining: 'チェイン法',
  linear: '線形走査法',
  quadratic: '二次走査法',
};

const WORD_POOL = [
  'sakura',
  'kaede',
  'tsubaki',
  'momiji',
  'ayame',
  'botan',
  'kikyo',
  'satsuki',
  'fuji',
  'kiri',
  'matsu',
  'sugi',
  'hinoki',
  'keyaki',
  'icho',
  'mokuren',
  'suzuran',
  'nadeshiko',
  'rindo',
  'hagi',
  'susuki',
  'yuri',
  'ume',
  'momo',
  'anzu',
  'biwa',
  'kaki',
  'kuri',
  'yuzu',
  'mikan',
];

function describeHashEvent(event: HashEvent): string {
  switch (event.type) {
    case 'hash':
      return `fnv1a("${event.key}") = 0x${event.hash.toString(16)} → 位置 ${event.index}`;
    case 'probe':
      return event.occupiedBy === null
        ? `スロット ${event.index} を走査(空きまたは墓石)`
        : `スロット ${event.index} を走査("${event.occupiedBy}" は別キー)`;
    case 'collision':
      return `位置 ${event.index} で "${event.withKey}" と衝突`;
    case 'place':
      return `位置 ${event.index} に "${event.key}" を格納`;
    case 'found':
      return `位置 ${event.index} で "${event.key}" を発見`;
    case 'not-found':
      return `"${event.key}" は存在しない`;
    case 'duplicate':
      return `"${event.key}" は既に存在する`;
    case 'remove':
      return `位置 ${event.index} から "${event.key}" を削除`;
    case 'tombstone':
      return `スロット ${event.index} に墓石を残す(走査を途切れさせないため)`;
    case 'rehash':
      return `負荷率が上限を超過: 容量 ${event.oldCapacity} → ${event.newCapacity} に再ハッシュ(${event.movedKeys} キーを再配置)`;
  }
}

const CELL_WIDTH = 84;
const CELL_HEIGHT = 30;
const CELL_GAP = 8;
const INDEX_WIDTH = 36;

class HashView {
  private table = new HashTable('chaining');
  private insertionOrder: string[] = [];
  private readonly sequencer = new Sequencer();

  private readonly svg: SVGSVGElement;
  private readonly input: HTMLInputElement;
  private readonly strategySelect: HTMLSelectElement;
  private readonly stats: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly loadFill: HTMLElement;
  private readonly loadLabel: HTMLElement;
  private readonly log: OperationLog;

  constructor(panel: HTMLElement) {
    panel.innerHTML = `
      <div class="workbench">
        <section class="viz-card">
          <div class="controls">
            <label class="field">キー
              <input type="text" maxlength="12" value="sakura" aria-label="操作するキー" />
            </label>
            <button type="button" class="primary" data-act="insert">挿入</button>
            <button type="button" data-act="delete">削除</button>
            <button type="button" data-act="search">検索</button>
            <span class="controls-gap" role="presentation"></span>
            <button type="button" data-act="random">ランダム5件</button>
            <button type="button" data-act="clear">全消去</button>
            <label class="field">方式
              <select aria-label="衝突の解決方式">
                <option value="chaining" selected>チェイン法</option>
                <option value="linear">線形走査法</option>
                <option value="quadratic">二次走査法</option>
              </select>
            </label>
          </div>
          <p class="stats" aria-live="polite"></p>
          <div class="load-meter">
            <div class="load-track" role="presentation"><div class="load-fill"></div></div>
            <span class="load-label"></span>
          </div>
          <p class="readout" aria-live="polite"></p>
          <div class="canvas" tabindex="0" role="img" aria-label="ハッシュテーブルの内部状態図"></div>
          ${LEGEND}
        </section>
        <aside class="log-card">
          <h3>操作ログ</h3>
          <div class="log-list" aria-live="polite"></div>
        </aside>
      </div>
    `;
    this.svg = svgEl('svg');
    panel.querySelector('.canvas')?.append(this.svg);
    this.input = panel.querySelector('input') as HTMLInputElement;
    this.strategySelect = panel.querySelector('select') as HTMLSelectElement;
    this.stats = panel.querySelector('.stats') as HTMLElement;
    this.readout = panel.querySelector('.readout') as HTMLElement;
    this.loadFill = panel.querySelector('.load-fill') as HTMLElement;
    this.loadLabel = panel.querySelector('.load-label') as HTMLElement;
    this.log = new OperationLog(panel.querySelector('.log-list') as HTMLElement);

    panel.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-act]');
      if (button) this.handle((button as HTMLElement).dataset.act ?? '');
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handle('insert');
    });
    this.strategySelect.addEventListener('change', () => this.switchStrategy());

    this.seed();
    this.render();
  }

  private seed(): void {
    const sample = WORD_POOL.slice(0, 5);
    for (const key of sample) {
      this.table.insert(key);
      this.insertionOrder.push(key);
    }
    this.log.add('初期データ', [`${sample.length} 個のキーを挿入: ${sample.join(', ')}`]);
  }

  private readKey(): string | null {
    const value = this.input.value.trim();
    if (value.length === 0) {
      this.input.setAttribute('aria-invalid', 'true');
      this.input.focus();
      return null;
    }
    this.input.removeAttribute('aria-invalid');
    return value;
  }

  private handle(action: string): void {
    if (action === 'random') {
      const candidates = WORD_POOL.filter((word) => !this.table.has(word));
      const added: string[] = [];
      while (added.length < 5) {
        const word =
          candidates.length > 0
            ? (candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0] as string)
            : `key-${Math.floor(Math.random() * 1000)}`;
        if (this.table.has(word)) continue;
        this.table.insert(word);
        this.insertionOrder.push(word);
        added.push(word);
      }
      this.render();
      this.log.add(`ランダム挿入 (${added.length}件)`, [`追加: ${added.join(', ')}`]);
      return;
    }
    if (action === 'clear') {
      this.table = new HashTable(this.strategySelect.value as HashStrategy);
      this.insertionOrder = [];
      this.readout.textContent = '';
      this.render();
      this.log.add('全消去', ['空のテーブルに戻した']);
      return;
    }
    const key = this.readKey();
    if (key === null) return;
    let events: HashEvent[];
    let title: string;
    if (action === 'insert') {
      events = this.table.insert(key);
      if (events.some((e) => e.type === 'place')) this.insertionOrder.push(key);
      title = `挿入 "${key}"`;
    } else if (action === 'delete') {
      events = this.table.remove(key);
      if (events.some((e) => e.type === 'remove')) {
        this.insertionOrder = this.insertionOrder.filter((k) => k !== key);
      }
      title = `削除 "${key}"`;
    } else {
      events = this.table.lookup(key);
      title = `検索 "${key}"`;
    }
    this.render();
    this.log.add(title, events.map(describeHashEvent));
    this.playEvents(events);
  }

  private switchStrategy(): void {
    const strategy = this.strategySelect.value as HashStrategy;
    this.table = new HashTable(strategy);
    for (const key of this.insertionOrder) this.table.insert(key);
    this.readout.textContent = '';
    this.render();
    const label = STRATEGY_LABELS[strategy];
    this.log.add(`方式を${label}に変更`, [
      `${this.insertionOrder.length} 個のキーを同じ順序で挿入し直した`,
    ]);
  }

  private render(): void {
    if (this.table.strategy === 'chaining') {
      this.renderChains();
    } else {
      this.renderSlots();
    }
    const tail =
      this.table.strategy === 'chaining'
        ? `最長チェーン ${this.table.longestCluster()}`
        : `墓石 ${this.table.tombstoneCount} / 最長クラスタ ${this.table.longestCluster()}`;
    this.stats.textContent = `要素数 ${this.table.size} / 容量 ${this.table.capacity} / ${tail}`;
    const load = this.table.loadFactor;
    const limit = this.table.loadLimit;
    this.loadFill.style.width = `${Math.min(100, (load / limit) * 100)}%`;
    this.loadFill.classList.toggle('load-high', load > limit * 0.8);
    this.loadLabel.textContent = `負荷率 ${load.toFixed(2)}(上限 ${limit})`;
  }

  // バケット配列を縦に並べ、チェーンを右へ伸ばす
  private renderChains(): void {
    const chains = this.table.chainSnapshot();
    const rowHeight = CELL_HEIGHT + CELL_GAP;
    const maxChain = Math.max(1, ...chains.map((chain) => chain.length));
    const width = INDEX_WIDTH + CELL_GAP + maxChain * (CELL_WIDTH + CELL_GAP);
    const height = chains.length * rowHeight - CELL_GAP;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.replaceChildren();

    chains.forEach((chain, index) => {
      const y = index * rowHeight;
      const bucket = svgEl('g', { class: 'hb-bucket', 'data-bucket': String(index) });
      bucket.append(
        svgEl('rect', {
          class: 'hb-index',
          width: String(INDEX_WIDTH),
          height: String(CELL_HEIGHT),
          rx: '6',
        }),
      );
      const indexText = svgEl('text', {
        class: 'hb-index-text',
        x: String(INDEX_WIDTH / 2),
        y: String(CELL_HEIGHT / 2),
      });
      indexText.textContent = String(index);
      bucket.append(indexText);
      bucket.style.transform = `translate(0px, ${y}px)`;
      this.svg.append(bucket);

      chain.forEach((key, position) => {
        const x = INDEX_WIDTH + CELL_GAP + position * (CELL_WIDTH + CELL_GAP);
        this.svg.append(
          svgEl('line', {
            class: 'hb-link',
            x1: String(x - CELL_GAP),
            y1: String(y + CELL_HEIGHT / 2),
            x2: String(x),
            y2: String(y + CELL_HEIGHT / 2),
          }),
        );
        const cell = svgEl('g', {
          class: 'hb-cell',
          'data-bucket': String(index),
          'data-key': key,
        });
        cell.append(
          svgEl('rect', {
            class: 'hb-cell-box',
            width: String(CELL_WIDTH),
            height: String(CELL_HEIGHT),
            rx: '6',
          }),
        );
        const text = svgEl('text', {
          class: 'hb-cell-text',
          x: String(CELL_WIDTH / 2),
          y: String(CELL_HEIGHT / 2),
        });
        text.textContent = key;
        cell.append(text);
        cell.style.transform = `translate(${x}px, ${y}px)`;
        this.svg.append(cell);
      });
    });
  }

  // 開番地法はスロットの一次元配列を8列で折り返して描く
  private renderSlots(): void {
    const slots = this.table.slotSnapshot();
    const columns = 8;
    const rows = Math.ceil(slots.length / columns);
    const width = columns * (CELL_WIDTH + CELL_GAP) - CELL_GAP;
    const height = rows * (CELL_HEIGHT + CELL_GAP + 14) - CELL_GAP;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.replaceChildren();

    slots.forEach((slot, index) => {
      const x = (index % columns) * (CELL_WIDTH + CELL_GAP);
      const y = Math.floor(index / columns) * (CELL_HEIGHT + CELL_GAP + 14) + 12;
      const cell = svgEl('g', { class: `hb-cell hb-${slot.state}`, 'data-slot': String(index) });
      const label = svgEl('text', { class: 'hb-slot-index', x: '2', y: '-4' });
      label.textContent = String(index);
      cell.append(label);
      cell.append(
        svgEl('rect', {
          class: 'hb-cell-box',
          width: String(CELL_WIDTH),
          height: String(CELL_HEIGHT),
          rx: '6',
        }),
      );
      const text = svgEl('text', {
        class: 'hb-cell-text',
        x: String(CELL_WIDTH / 2),
        y: String(CELL_HEIGHT / 2),
      });
      text.textContent =
        slot.state === 'occupied' ? slot.key : slot.state === 'tombstone' ? '墓石' : '';
      cell.append(text);
      cell.style.transform = `translate(${x}px, ${y}px)`;
      this.svg.append(cell);
    });
  }

  private cellAt(index: number): SVGGElement | null {
    if (this.table.strategy === 'chaining') {
      return this.svg.querySelector(`g.hb-bucket[data-bucket="${index}"]`);
    }
    return this.svg.querySelector(`g.hb-cell[data-slot="${index}"]`);
  }

  private cellOf(index: number, key: string): SVGGElement | null {
    if (this.table.strategy === 'chaining') {
      const escaped = key.replace(/"/g, '\\"');
      return this.svg.querySelector(`g.hb-cell[data-bucket="${index}"][data-key="${escaped}"]`);
    }
    return this.cellAt(index);
  }

  private playEvents(events: HashEvent[]): void {
    this.svg
      .querySelectorAll('.hl-visit, .hl-found, .hl-new, .hl-warn, .hl-change')
      .forEach((element) =>
        element.classList.remove('hl-visit', 'hl-found', 'hl-new', 'hl-warn', 'hl-change'),
      );

    // 再ハッシュが起きた場合、それ以前の位置は新しい配置と食い違うため
    // 個別ハイライトはやめて全体のフラッシュで置き換える
    if (events.some((e) => e.type === 'rehash')) {
      const cells = [...this.svg.querySelectorAll('g.hb-cell')];
      this.sequencer.play(
        cells.map((cell) => () => cell.classList.add('hl-change')),
        30,
      );
      const hashEvent = events.find((e) => e.type === 'hash');
      if (hashEvent && hashEvent.type === 'hash') this.showReadout(hashEvent);
      return;
    }

    const steps: (() => void)[] = [];
    for (const event of events) {
      steps.push(() => {
        switch (event.type) {
          case 'hash':
            this.showReadout(event);
            this.cellAt(event.index)?.classList.add('hl-visit');
            break;
          case 'probe':
            this.cellAt(event.index)?.classList.add('hl-visit');
            break;
          case 'collision':
            this.cellOf(event.index, event.withKey)?.classList.add('hl-warn');
            break;
          case 'place':
            this.cellOf(event.index, event.key)?.classList.add('hl-new');
            break;
          case 'found':
            this.cellOf(event.index, event.key)?.classList.add('hl-found');
            break;
          case 'duplicate':
            this.cellOf(event.index, event.key)?.classList.add('hl-warn');
            break;
          case 'remove':
          case 'tombstone':
            this.cellAt(event.index)?.classList.add('hl-change');
            break;
          case 'not-found':
          case 'rehash':
            break;
        }
      });
    }
    this.sequencer.play(steps, currentInterval);
  }

  private showReadout(event: { key: string; hash: number; index: number }): void {
    this.readout.textContent =
      `fnv1a("${event.key}") = 0x${event.hash.toString(16).padStart(8, '0')}` +
      ` , 0x${event.hash.toString(16).padStart(8, '0')} mod ${this.table.capacity} = ${event.index}`;
  }
}

const LOGO = `
<svg viewBox="0 0 64 64" aria-hidden="true" class="brand-logo">
  <rect x="20" y="8" width="24" height="14" rx="4" class="logo-accent"/>
  <line x1="26" y1="22" x2="13" y2="38" class="logo-line"/>
  <line x1="38" y1="22" x2="51" y2="38" class="logo-line"/>
  <rect x="4" y="38" width="18" height="14" rx="4" class="logo-base"/>
  <rect x="42" y="38" width="18" height="14" rx="4" class="logo-accent-soft"/>
</svg>
`;

const THEME_ICON =
  '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/></svg>';

/** テーマ(自動 / ライト / ダーク)の切替。選択は localStorage に残し、自動時はOSに追従。 */
function setupTheme(root: HTMLElement): void {
  const btn = root.querySelector('#theme-toggle') as HTMLButtonElement | null;
  const labelEl = root.querySelector('#theme-label') as HTMLElement | null;
  if (!btn || !labelEl) return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let choice: ThemeChoice = parseChoice(safeRead(THEME_STORAGE_KEY));
  const apply = (): void => {
    document.documentElement.dataset.theme = resolveTheme(choice, media.matches);
    labelEl.textContent = choiceLabel(choice);
    btn.dataset.choice = choice;
    btn.setAttribute('aria-label', `テーマ: ${choiceLabel(choice)}。クリックで切り替え`);
  };
  btn.addEventListener('click', () => {
    choice = nextChoice(choice);
    safeWrite(THEME_STORAGE_KEY, choice);
    apply();
  });
  media.addEventListener('change', () => {
    if (choice === 'system') apply();
  });
  apply();
}

/** 再生速度の選択。両ビューが参照する currentInterval を更新し、選択を保存する。 */
function setupSpeed(root: HTMLElement): void {
  const select = root.querySelector('#speed-select') as HTMLSelectElement | null;
  if (!select) return;
  const speed: Speed = parseSpeed(safeRead(SPEED_STORAGE_KEY));
  select.value = speed;
  currentInterval = intervalFor(speed);
  select.addEventListener('change', () => {
    const next = parseSpeed(select.value);
    currentInterval = intervalFor(next);
    safeWrite(SPEED_STORAGE_KEY, next);
  });
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ストレージ不可でもUIは動かす */
  }
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="shell">
      <header class="masthead">
        <div class="masthead-main">
          ${LOGO}
          <div class="masthead-text">
            <p class="kicker">Data Structure Playground</p>
            <h1>structlab</h1>
            <p class="lede">B木とハッシュテーブルの内部を、キーの出し入れで観察するプレイグラウンド</p>
          </div>
        </div>
        <div class="toolbar">
          <label class="field speed-control">速度
            <select id="speed-select" aria-label="再生速度">
              ${SPEEDS.map((s) => `<option value="${s}">${SPEED_LABELS[s]}</option>`).join('')}
            </select>
          </label>
          <button type="button" id="theme-toggle" class="theme-toggle">
            ${THEME_ICON}<span id="theme-label" class="theme-label">自動</span>
          </button>
        </div>
      </header>
      <nav class="tabs" role="tablist" aria-label="データ構造の選択">
        <button role="tab" id="tab-btree" aria-controls="panel-btree" aria-selected="true">B木</button>
        <button role="tab" id="tab-hash" aria-controls="panel-hash" aria-selected="false">ハッシュテーブル</button>
      </nav>
      <main>
        <section id="panel-btree" role="tabpanel" aria-labelledby="tab-btree"></section>
        <section id="panel-hash" role="tabpanel" aria-labelledby="tab-hash" hidden></section>
      </main>
      <footer class="footnote">
        <a href="https://github.com/miruky/structlab">GitHub</a>
      </footer>
    </div>
  `;

  setupTheme(root);
  setupSpeed(root);

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const hashes = ['#btree', '#hash'];
  const select = (index: number): void => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      const panel = panels[i];
      if (panel) panel.hidden = i !== index;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      select(index);
      history.replaceState(null, '', hashes[index] ?? '#btree');
    });
  });
  // URLのハッシュで開くタブを指定できる(共有用)
  const initial = hashes.indexOf(location.hash);
  if (initial > 0) select(initial);

  const btreePanel = panels[0];
  const hashPanel = panels[1];
  if (btreePanel) new BTreeView(btreePanel);
  if (hashPanel) new HashView(hashPanel);
}
