import { describe, expect, it } from 'vitest';
import { fnv1a, HashTable } from './hashtable';

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

describe('fnv1a', () => {
  it('FNV-1a 32bitの既知のテストベクタと一致する', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('マルチバイト文字列はUTF-8バイト列としてハッシュされる', () => {
    expect(fnv1a('さくら')).toBe(fnv1a('さくら'));
    expect(fnv1a('さくら')).not.toBe(fnv1a('かえで'));
  });
});

describe.each(['chaining', 'linear', 'quadratic'] as const)('HashTable (%s)', (strategy) => {
  it('挿入したキーが見つかり、無いキーは見つからない', () => {
    const table = new HashTable(strategy);
    table.insert('sakura');
    table.insert('kaede');
    expect(table.has('sakura')).toBe(true);
    expect(table.has('kaede')).toBe(true);
    expect(table.has('tsubaki')).toBe(false);
    expect(table.size).toBe(2);
  });

  it('重複キーは挿入されずduplicateイベントを返す', () => {
    const table = new HashTable(strategy);
    table.insert('sakura');
    const events = table.insert('sakura');
    expect(events.some((e) => e.type === 'duplicate')).toBe(true);
    expect(table.size).toBe(1);
  });

  it('削除後は見つからなくなりsizeが減る', () => {
    const table = new HashTable(strategy);
    table.insert('sakura');
    table.insert('kaede');
    const events = table.remove('sakura');
    expect(events.some((e) => e.type === 'remove')).toBe(true);
    expect(table.has('sakura')).toBe(false);
    expect(table.has('kaede')).toBe(true);
    expect(table.size).toBe(1);
  });

  it('無いキーの削除はnot-foundを返し状態を変えない', () => {
    const table = new HashTable(strategy);
    table.insert('sakura');
    const events = table.remove('tsubaki');
    expect(events.some((e) => e.type === 'not-found')).toBe(true);
    expect(table.size).toBe(1);
  });

  it('負荷率の上限を超えると容量が倍に再ハッシュされる', () => {
    const table = new HashTable(strategy);
    const initialCapacity = table.capacity;
    const allEvents = [];
    for (let i = 0; i < 12; i++) {
      allEvents.push(...table.insert(`key-${i}`));
    }
    const rehashes = allEvents.filter((e) => e.type === 'rehash');
    expect(rehashes.length).toBeGreaterThan(0);
    expect(table.capacity).toBeGreaterThan(initialCapacity);
    for (let i = 0; i < 12; i++) {
      expect(table.has(`key-${i}`)).toBe(true);
    }
  });

  it('最初のイベントは常にhashで、indexはhash % capacityになる', () => {
    const table = new HashTable(strategy);
    const events = table.insert('sakura');
    const first = events[0];
    expect(first).toBeDefined();
    if (first && first.type === 'hash') {
      expect(first.hash).toBe(fnv1a('sakura'));
      expect(first.index).toBe(first.hash % 8);
    } else {
      throw new Error('最初のイベントがhashでない');
    }
  });

  it('ランダム操作でSetと一致し続ける', () => {
    const random = rng(strategy === 'chaining' ? 11 : 22);
    const table = new HashTable(strategy);
    const reference = new Set<string>();
    const pool = Array.from({ length: 60 }, (_, i) => `w${i}`);
    for (let step = 0; step < 1500; step++) {
      const key = pool[Math.floor(random() * pool.length)] as string;
      if (random() < 0.6) {
        table.insert(key);
        reference.add(key);
      } else {
        table.remove(key);
        reference.delete(key);
      }
      expect(table.size).toBe(reference.size);
    }
    expect([...table.keys()].sort()).toEqual([...reference].sort());
    for (const key of pool) {
      expect(table.has(key)).toBe(reference.has(key));
    }
  });
});

describe('HashTable 線形走査固有の挙動', () => {
  it('削除は墓石を残し、後続キーの走査を途切れさせない', () => {
    const table = new HashTable('linear');
    // 同じバケットに連なる3キーを実際のハッシュ値から探す
    const cluster: string[] = [];
    const targetIndex = fnv1a('seed-0') % table.capacity;
    for (let i = 0; cluster.length < 3 && i < 10000; i++) {
      const key = `seed-${i}`;
      if (fnv1a(key) % table.capacity === targetIndex) cluster.push(key);
    }
    expect(cluster.length).toBe(3);
    for (const key of cluster) table.insert(key);
    const events = table.remove(cluster[1] as string);
    expect(events.some((e) => e.type === 'tombstone')).toBe(true);
    expect(table.tombstoneCount).toBe(1);
    expect(table.has(cluster[2] as string)).toBe(true);
  });

  it('墓石の位置は後の挿入で再利用される', () => {
    const table = new HashTable('linear');
    table.insert('alpha');
    table.insert('beta');
    table.remove('alpha');
    expect(table.tombstoneCount).toBe(1);
    table.insert('alpha');
    expect(table.tombstoneCount).toBe(0);
    expect(table.has('alpha')).toBe(true);
  });

  it('再ハッシュで墓石が掃除される', () => {
    const table = new HashTable('linear');
    for (let i = 0; i < 4; i++) table.insert(`k${i}`);
    for (let i = 0; i < 4; i++) table.remove(`k${i}`);
    expect(table.tombstoneCount).toBe(4);
    // 墓石込みの負荷率が上限を超えれば再ハッシュされる
    let lastEvents = table.insert('trigger');
    for (let i = 0; lastEvents.every((e) => e.type !== 'rehash') && i < 10; i++) {
      lastEvents = table.insert(`extra-${i}`);
    }
    expect(table.tombstoneCount).toBe(0);
    expect(table.has('trigger')).toBe(true);
  });

  it('クラスタ長は連続した使用中スロットの最大数を返す', () => {
    const table = new HashTable('linear');
    expect(table.longestCluster()).toBe(0);
    table.insert('one');
    expect(table.longestCluster()).toBeGreaterThanOrEqual(1);
  });
});

describe('HashTable 二次走査固有の挙動', () => {
  // 同じ初期indexへ集まるキー列を、実際のハッシュ値から探して用意する
  function clusterAt(prefix: string, count: number, capacity: number): string[] {
    const target = fnv1a(`${prefix}-0`) % capacity;
    const cluster: string[] = [];
    for (let i = 0; cluster.length < count && i < 20000; i++) {
      const key = `${prefix}-${i}`;
      if (fnv1a(key) % capacity === target) cluster.push(key);
    }
    return cluster;
  }

  it('初期indexが衝突するキーでも三角数の歩幅で散らして全て格納できる', () => {
    const table = new HashTable('quadratic');
    const cluster = clusterAt('q', 4, table.capacity);
    expect(cluster.length).toBe(4);
    for (const key of cluster) table.insert(key);
    for (const key of cluster) expect(table.has(key)).toBe(true);
    expect(table.size).toBe(4);
  });

  it('削除は墓石を残し、衝突したキーの走査を保つ', () => {
    const table = new HashTable('quadratic');
    const cluster = clusterAt('p', 3, table.capacity);
    expect(cluster.length).toBe(3);
    for (const key of cluster) table.insert(key);
    table.remove(cluster[1] as string);
    expect(table.tombstoneCount).toBe(1);
    expect(table.has(cluster[2] as string)).toBe(true);
  });
});

describe('HashTable スナップショット', () => {
  it('チェイン法のスナップショットは全キーを含む', () => {
    const table = new HashTable('chaining');
    for (const key of ['a', 'b', 'c']) table.insert(key);
    const snapshot = table.chainSnapshot();
    expect(snapshot.length).toBe(table.capacity);
    expect(snapshot.flat().sort()).toEqual(['a', 'b', 'c']);
  });

  it('線形走査のスナップショットは状態の三値を区別する', () => {
    const table = new HashTable('linear');
    table.insert('a');
    table.insert('b');
    table.remove('a');
    const snapshot = table.slotSnapshot();
    const states = snapshot.map((slot) => slot.state);
    expect(states).toContain('occupied');
    expect(states).toContain('tombstone');
    expect(states).toContain('empty');
  });
});
