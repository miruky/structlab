import { describe, expect, it } from 'vitest';
import { BTree } from './btree';
import { DEFAULT_LAYOUT, layoutTree } from './treelayout';

describe('layoutTree', () => {
  it('空の木でも1ノード分の枠を返す', () => {
    const tree = new BTree(2);
    const layout = layoutTree(tree.root);
    expect(layout.nodes.length).toBe(1);
    expect(layout.edges.length).toBe(0);
    expect(layout.width).toBe(DEFAULT_LAYOUT.keyWidth);
    expect(layout.height).toBe(DEFAULT_LAYOUT.nodeHeight);
  });

  it('ノード幅はキー数に比例する', () => {
    const tree = new BTree(2);
    tree.insert(10);
    tree.insert(20);
    tree.insert(30);
    const layout = layoutTree(tree.root);
    const node = layout.nodes[0];
    expect(node?.keys).toEqual([10, 20, 30]);
    expect(node?.width).toBe(3 * DEFAULT_LAYOUT.keyWidth);
  });

  it('全ノードが描かれ、エッジ数はノード数-1になる', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 30; k++) tree.insert(k);
    const layout = layoutTree(tree.root);
    expect(layout.nodes.length).toBe(tree.nodeCount());
    expect(layout.edges.length).toBe(tree.nodeCount() - 1);
  });

  it('同じ深さのノードは重ならない', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 50; k++) tree.insert(k);
    const layout = layoutTree(tree.root);
    const byDepth = new Map<number, { x: number; width: number }[]>();
    for (const node of layout.nodes) {
      const row = byDepth.get(node.y) ?? [];
      row.push({ x: node.x, width: node.width });
      byDepth.set(node.y, row);
    }
    for (const row of byDepth.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1] as { x: number; width: number };
        const current = row[i] as { x: number; width: number };
        expect(current.x).toBeGreaterThanOrEqual(prev.x + prev.width);
      }
    }
  });

  it('エッジは親の下端からキー境界を通って子の上端中央へ向かう', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 10; k++) tree.insert(k);
    const layout = layoutTree(tree.root);
    const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const edge of layout.edges) {
      const parent = nodeById.get(edge.fromId);
      const child = nodeById.get(edge.toId);
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      if (!parent || !child) continue;
      expect(edge.y1).toBe(parent.y + parent.height);
      expect(edge.y2).toBe(child.y);
      expect(edge.x1).toBeGreaterThanOrEqual(parent.x);
      expect(edge.x1).toBeLessThanOrEqual(parent.x + parent.width);
      expect(edge.x2).toBe(child.x + child.width / 2);
    }
  });

  it('親は子の並びの中央に置かれる', () => {
    const tree = new BTree(2);
    for (let k = 1; k <= 7; k++) tree.insert(k);
    const layout = layoutTree(tree.root);
    const rootPlaced = layout.nodes.find((n) => n.id === tree.root.id);
    expect(rootPlaced).toBeDefined();
    if (!rootPlaced) return;
    const children = layout.nodes.filter((n) => n.y > rootPlaced.y && n.y <= rootPlaced.y + 100);
    const minX = Math.min(...children.map((n) => n.x));
    const maxX = Math.max(...children.map((n) => n.x + n.width));
    const rootCenter = rootPlaced.x + rootPlaced.width / 2;
    expect(Math.abs(rootCenter - (minX + maxX) / 2)).toBeLessThan(1);
  });
});
