import { describe, expect, it } from 'vitest';
import { BTree } from './btree';

// 再現可能な擬似乱数(mulberry32)
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

describe('BTree 挿入', () => {
  it('昇順挿入でもキーは整列され不変条件を保つ', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 50; k++) tree.insert(k);
    expect(tree.keys()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(tree.validate()).toEqual([]);
  });

  it('根が満杯になると分割されて高さが増える', () => {
    const tree = new BTree(2);
    tree.insert(10);
    tree.insert(20);
    tree.insert(30);
    expect(tree.height()).toBe(1);
    const events = tree.insert(40);
    expect(events.some((e) => e.type === 'new-root')).toBe(true);
    expect(events.some((e) => e.type === 'split')).toBe(true);
    expect(tree.height()).toBe(2);
  });

  it('重複キーは挿入されずduplicateイベントを返す', () => {
    const tree = new BTree(2);
    tree.insert(5);
    const events = tree.insert(5);
    expect(events.some((e) => e.type === 'duplicate')).toBe(true);
    expect(tree.keys()).toEqual([5]);
  });

  it('分割で親へ上がった直後のキーとの重複も検出する', () => {
    const tree = new BTree(2);
    for (const k of [10, 20, 30, 40, 50, 60, 70]) tree.insert(k);
    const before = tree.keys();
    const events = tree.insert(before[Math.floor(before.length / 2)] as number);
    expect(events.some((e) => e.type === 'duplicate')).toBe(true);
    expect(tree.keys()).toEqual(before);
  });

  it('最小次数3でも不変条件を保つ', () => {
    const tree = new BTree(3);
    for (let k = 100; k >= 1; k--) tree.insert(k);
    expect(tree.keys()).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(tree.validate()).toEqual([]);
  });

  it('不正な最小次数を拒否する', () => {
    expect(() => new BTree(1)).toThrow(RangeError);
    expect(() => new BTree(2.5)).toThrow(RangeError);
  });
});

describe('BTree 検索', () => {
  it('存在するキーはfound、無いキーはnot-foundになる', () => {
    const tree = new BTree(2);
    for (const k of [8, 3, 12, 1, 6, 10, 14]) tree.insert(k);
    expect(tree.search(6).at(-1)).toEqual({ type: 'found', nodeId: expect.any(Number), key: 6 });
    expect(tree.search(7).at(-1)).toEqual({ type: 'not-found', key: 7 });
    expect(tree.has(14)).toBe(true);
    expect(tree.has(0)).toBe(false);
  });

  it('検索イベントは根から葉への訪問列になる', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 30; k++) tree.insert(k);
    const events = tree.search(17);
    const visits = events.filter((e) => e.type === 'visit');
    expect(visits.length).toBe(tree.height());
    expect(visits[0]).toMatchObject({ type: 'visit', nodeId: tree.root.id });
  });
});

describe('BTree 削除', () => {
  it('葉からの削除', () => {
    const tree = new BTree(2);
    for (const k of [10, 20, 30]) tree.insert(k);
    const events = tree.delete(20);
    expect(events.some((e) => e.type === 'remove-key')).toBe(true);
    expect(tree.keys()).toEqual([10, 30]);
    expect(tree.validate()).toEqual([]);
  });

  it('内部ノードのキーは先行または後続キーで置換される', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 20; k++) tree.insert(k);
    const internalKey = tree.root.keys[0] as number;
    const events = tree.delete(internalKey);
    expect(events.some((e) => e.type === 'replace-key' || e.type === 'merge')).toBe(true);
    expect(tree.has(internalKey)).toBe(false);
    expect(tree.validate()).toEqual([]);
  });

  it('全キーを削除すると空の根だけが残る', () => {
    const tree = new BTree(2);
    const keys = [5, 3, 8, 1, 4, 7, 9, 2, 6, 10];
    for (const k of keys) tree.insert(k);
    for (const k of keys) {
      tree.delete(k);
      expect(tree.validate()).toEqual([]);
    }
    expect(tree.keys()).toEqual([]);
    expect(tree.height()).toBe(1);
    expect(tree.nodeCount()).toBe(1);
  });

  it('高さが下がるときshrink-rootイベントを返す', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 10; k++) tree.insert(k);
    const heightBefore = tree.height();
    const all: string[] = [];
    for (let k = 1; k <= 10; k++) {
      for (const e of tree.delete(k)) all.push(e.type);
    }
    expect(heightBefore).toBeGreaterThan(1);
    expect(all).toContain('shrink-root');
  });

  it('無いキーの削除は木を変えずnot-foundを返す', () => {
    const tree = new BTree(2);
    for (const k of [10, 20, 30, 40, 50]) tree.insert(k);
    const before = tree.keys();
    const events = tree.delete(99);
    expect(events.some((e) => e.type === 'not-found')).toBe(true);
    expect(tree.keys()).toEqual(before);
    expect(tree.validate()).toEqual([]);
  });

  it('借用と統合の両方が発生しても整合する', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 64; k++) tree.insert(k);
    const types = new Set<string>();
    for (let k = 1; k <= 64; k += 2) {
      for (const e of tree.delete(k)) types.add(e.type);
      expect(tree.validate()).toEqual([]);
    }
    expect(types.has('borrow') || types.has('merge')).toBe(true);
    expect(tree.keys()).toEqual(Array.from({ length: 32 }, (_, i) => 2 * (i + 1)));
  });
});

describe('BTree ファズ', () => {
  for (const t of [2, 3] as const) {
    it(`最小次数${t}: ランダムな挿入と削除でSetと一致し続ける`, () => {
      const random = rng(t * 1000 + 7);
      const tree = new BTree(t);
      const reference = new Set<number>();
      for (let step = 0; step < 2000; step++) {
        const key = Math.floor(random() * 200);
        if (random() < 0.6) {
          tree.insert(key);
          reference.add(key);
        } else {
          tree.delete(key);
          reference.delete(key);
        }
        if (step % 100 === 0) expect(tree.validate()).toEqual([]);
      }
      expect(tree.validate()).toEqual([]);
      expect(tree.keys()).toEqual([...reference].sort((a, b) => a - b));
    });
  }
});
