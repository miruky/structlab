// B木をSVGに置くための座標計算。ノード幅はキー数に比例し、
// 子は親のキーの隙間(キー境界)からぶら下がる。

import type { BTreeNode } from './btree';

export interface LayoutOptions {
  keyWidth: number;
  nodeHeight: number;
  siblingGap: number;
  levelGap: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  keyWidth: 36,
  nodeHeight: 32,
  siblingGap: 16,
  levelGap: 56,
};

export interface PlacedNode {
  id: number;
  keys: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  isLeaf: boolean;
}

export interface PlacedEdge {
  fromId: number;
  toId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

function nodeWidth(node: BTreeNode, options: LayoutOptions): number {
  return Math.max(1, node.keys.length) * options.keyWidth;
}

function subtreeWidth(node: BTreeNode, options: LayoutOptions): number {
  if (node.children.length === 0) return nodeWidth(node, options);
  const childrenWidth = node.children.reduce(
    (sum, child, i) => sum + subtreeWidth(child, options) + (i > 0 ? options.siblingGap : 0),
    0,
  );
  return Math.max(nodeWidth(node, options), childrenWidth);
}

export function layoutTree(root: BTreeNode, options: LayoutOptions = DEFAULT_LAYOUT): TreeLayout {
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];

  const place = (node: BTreeNode, left: number, depth: number): PlacedNode => {
    const span = subtreeWidth(node, options);
    const width = nodeWidth(node, options);
    const x = left + (span - width) / 2;
    const y = depth * (options.nodeHeight + options.levelGap);
    const placed: PlacedNode = {
      id: node.id,
      keys: [...node.keys],
      x,
      y,
      width,
      height: options.nodeHeight,
      isLeaf: node.children.length === 0,
    };
    nodes.push(placed);

    let childLeft = left + (span - childrenSpan(node, options)) / 2;
    node.children.forEach((child, i) => {
      const childPlaced = place(child, childLeft, depth + 1);
      childLeft += subtreeWidth(child, options) + options.siblingGap;
      // 子iは親のキー境界i(左端からキー幅×i)から線を引く
      const anchorX = x + Math.min(i, node.keys.length) * options.keyWidth;
      edges.push({
        fromId: node.id,
        toId: child.id,
        x1: clamp(anchorX, x, x + width),
        y1: y + options.nodeHeight,
        x2: childPlaced.x + childPlaced.width / 2,
        y2: childPlaced.y,
      });
    });
    return placed;
  };

  place(root, 0, 0);
  const width = Math.max(...nodes.map((n) => n.x + n.width));
  const height = Math.max(...nodes.map((n) => n.y + n.height));
  return { nodes, edges, width, height };
}

function childrenSpan(node: BTreeNode, options: LayoutOptions): number {
  return node.children.reduce(
    (sum, child, i) => sum + subtreeWidth(child, options) + (i > 0 ? options.siblingGap : 0),
    0,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
