// ハッシュ表(キーの集合)。チェイン法と線形走査法の2方式を同じイベント語彙で
// 表現し、衝突・墓石・再ハッシュといった内部の動きを描画側へ伝える。

export type HashStrategy = 'chaining' | 'linear';

export type SlotState =
  | { state: 'empty' }
  | { state: 'occupied'; key: string }
  | { state: 'tombstone' };

export type HashEvent =
  | { type: 'hash'; key: string; hash: number; index: number }
  | { type: 'probe'; index: number; occupiedBy: string | null }
  | { type: 'collision'; index: number; withKey: string }
  | { type: 'place'; index: number; key: string }
  | { type: 'found'; index: number; key: string }
  | { type: 'not-found'; key: string }
  | { type: 'duplicate'; index: number; key: string }
  | { type: 'remove'; index: number; key: string }
  | { type: 'tombstone'; index: number }
  | { type: 'rehash'; oldCapacity: number; newCapacity: number; movedKeys: number };

const INITIAL_CAPACITY = 8;
// 線形走査は墓石も走査を伸ばすため、チェイン法より低い負荷率で広げる
const LOAD_FACTOR_LIMIT: Record<HashStrategy, number> = { chaining: 0.75, linear: 0.6 };

const utf8 = new TextEncoder();

export function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class HashTable {
  readonly strategy: HashStrategy;
  private chains: string[][] = [];
  private slots: (string | symbol | null)[] = [];
  private static readonly TOMBSTONE = Symbol('tombstone');
  private keyCount = 0;

  constructor(strategy: HashStrategy) {
    this.strategy = strategy;
    this.reset(INITIAL_CAPACITY);
  }

  private reset(capacity: number): void {
    this.chains = Array.from({ length: capacity }, () => []);
    this.slots = Array.from({ length: capacity }, () => null);
    this.keyCount = 0;
  }

  get capacity(): number {
    return this.strategy === 'chaining' ? this.chains.length : this.slots.length;
  }

  get size(): number {
    return this.keyCount;
  }

  get tombstoneCount(): number {
    if (this.strategy === 'chaining') return 0;
    return this.slots.filter((slot) => slot === HashTable.TOMBSTONE).length;
  }

  // 線形走査では墓石も走査コストになるため負荷率に含める
  get loadFactor(): number {
    if (this.strategy === 'chaining') return this.keyCount / this.capacity;
    return (this.keyCount + this.tombstoneCount) / this.capacity;
  }

  private indexOf(key: string): { hash: number; index: number } {
    const hash = fnv1a(key);
    return { hash, index: hash % this.capacity };
  }

  insert(key: string): HashEvent[] {
    const events: HashEvent[] = [];
    const { hash, index } = this.indexOf(key);
    events.push({ type: 'hash', key, hash, index });
    if (this.strategy === 'chaining') {
      this.insertChaining(key, index, events);
    } else {
      this.insertLinear(key, index, events);
    }
    if (this.loadFactor > LOAD_FACTOR_LIMIT[this.strategy]) {
      this.rehash(this.capacity * 2, events);
    }
    return events;
  }

  private insertChaining(key: string, index: number, events: HashEvent[]): void {
    const chain = this.chains[index] as string[];
    for (const existing of chain) {
      if (existing === key) {
        events.push({ type: 'duplicate', index, key });
        return;
      }
      events.push({ type: 'collision', index, withKey: existing });
    }
    chain.push(key);
    this.keyCount++;
    events.push({ type: 'place', index, key });
  }

  private insertLinear(key: string, start: number, events: HashEvent[]): void {
    let firstTombstone = -1;
    for (let step = 0; step < this.capacity; step++) {
      const index = (start + step) % this.capacity;
      const slot = this.slots[index];
      if (slot === null || slot === undefined) {
        events.push({ type: 'probe', index, occupiedBy: null });
        const target = firstTombstone >= 0 ? firstTombstone : index;
        this.slots[target] = key;
        this.keyCount++;
        events.push({ type: 'place', index: target, key });
        return;
      }
      if (slot === key) {
        events.push({ type: 'duplicate', index, key });
        return;
      }
      if (slot === HashTable.TOMBSTONE) {
        events.push({ type: 'probe', index, occupiedBy: null });
        if (firstTombstone < 0) firstTombstone = index;
      } else {
        events.push({ type: 'collision', index, withKey: slot as string });
      }
    }
    // 負荷率の上限により満杯前に必ず再ハッシュされるため、ここには到達しない
    throw new Error('挿入先が見つからない: 容量管理の不整合');
  }

  lookup(key: string): HashEvent[] {
    const events: HashEvent[] = [];
    const { hash, index } = this.indexOf(key);
    events.push({ type: 'hash', key, hash, index });
    if (this.strategy === 'chaining') {
      const chain = this.chains[index] as string[];
      for (const existing of chain) {
        if (existing === key) {
          events.push({ type: 'found', index, key });
          return events;
        }
        events.push({ type: 'collision', index, withKey: existing });
      }
      events.push({ type: 'not-found', key });
      return events;
    }
    for (let step = 0; step < this.capacity; step++) {
      const probeIndex = (index + step) % this.capacity;
      const slot = this.slots[probeIndex];
      if (slot === null || slot === undefined) {
        events.push({ type: 'probe', index: probeIndex, occupiedBy: null });
        break;
      }
      if (slot === key) {
        events.push({ type: 'found', index: probeIndex, key });
        return events;
      }
      events.push(
        slot === HashTable.TOMBSTONE
          ? { type: 'probe', index: probeIndex, occupiedBy: null }
          : { type: 'probe', index: probeIndex, occupiedBy: slot as string },
      );
    }
    events.push({ type: 'not-found', key });
    return events;
  }

  has(key: string): boolean {
    return this.lookup(key).some((e) => e.type === 'found');
  }

  remove(key: string): HashEvent[] {
    const events: HashEvent[] = [];
    const { hash, index } = this.indexOf(key);
    events.push({ type: 'hash', key, hash, index });
    if (this.strategy === 'chaining') {
      const chain = this.chains[index] as string[];
      const position = chain.indexOf(key);
      if (position < 0) {
        events.push({ type: 'not-found', key });
        return events;
      }
      chain.splice(position, 1);
      this.keyCount--;
      events.push({ type: 'remove', index, key });
      return events;
    }
    for (let step = 0; step < this.capacity; step++) {
      const probeIndex = (index + step) % this.capacity;
      const slot = this.slots[probeIndex];
      if (slot === null || slot === undefined) break;
      if (slot === key) {
        // 空きにすると後続キーへの走査が途切れるため墓石を残す
        this.slots[probeIndex] = HashTable.TOMBSTONE;
        this.keyCount--;
        events.push({ type: 'remove', index: probeIndex, key });
        events.push({ type: 'tombstone', index: probeIndex });
        return events;
      }
      events.push(
        slot === HashTable.TOMBSTONE
          ? { type: 'probe', index: probeIndex, occupiedBy: null }
          : { type: 'probe', index: probeIndex, occupiedBy: slot as string },
      );
    }
    events.push({ type: 'not-found', key });
    return events;
  }

  private rehash(newCapacity: number, events: HashEvent[]): void {
    const oldCapacity = this.capacity;
    const keys = this.keys();
    this.reset(newCapacity);
    for (const key of keys) {
      const { index } = this.indexOf(key);
      if (this.strategy === 'chaining') {
        (this.chains[index] as string[]).push(key);
      } else {
        let probeIndex = index;
        while (this.slots[probeIndex] !== null) probeIndex = (probeIndex + 1) % newCapacity;
        this.slots[probeIndex] = key;
      }
    }
    this.keyCount = keys.length;
    events.push({ type: 'rehash', oldCapacity, newCapacity, movedKeys: keys.length });
  }

  keys(): string[] {
    if (this.strategy === 'chaining') return this.chains.flat();
    return this.slots.filter((slot): slot is string => typeof slot === 'string');
  }

  // 描画用のスナップショット。チェイン法はバケットごとのキー列、
  // 線形走査はスロットごとの状態を返す。
  chainSnapshot(): string[][] {
    return this.chains.map((chain) => [...chain]);
  }

  slotSnapshot(): SlotState[] {
    return this.slots.map((slot) => {
      if (typeof slot === 'string') return { state: 'occupied', key: slot };
      if (slot === HashTable.TOMBSTONE) return { state: 'tombstone' };
      return { state: 'empty' };
    });
  }

  longestCluster(): number {
    if (this.strategy === 'chaining') {
      return this.chains.reduce((max, chain) => Math.max(max, chain.length), 0);
    }
    let max = 0;
    let run = 0;
    // クラスタは環状に連続しうるため2周分を見る
    for (let i = 0; i < this.capacity * 2; i++) {
      if (this.slots[i % this.capacity] !== null) {
        run++;
        if (run >= this.capacity) return this.capacity;
        max = Math.max(max, run);
      } else {
        run = 0;
      }
    }
    return max;
  }
}
