// B木(最小次数t)。各操作は構造の変化を表すイベント列を返し、描画側が
// それを再生してハイライトする。木の状態そのものはノードを直接たどって読む。

export interface BTreeNode {
  readonly id: number;
  keys: number[];
  children: BTreeNode[];
}

export type BTreeEvent =
  | { type: 'visit'; nodeId: number; keys: number[] }
  | { type: 'found'; nodeId: number; key: number }
  | { type: 'not-found'; key: number }
  | { type: 'duplicate'; nodeId: number; key: number }
  | { type: 'insert-key'; nodeId: number; key: number }
  | { type: 'remove-key'; nodeId: number; key: number }
  | { type: 'replace-key'; nodeId: number; oldKey: number; newKey: number }
  | { type: 'split'; parentId: number; leftId: number; rightId: number; middleKey: number }
  | { type: 'new-root'; nodeId: number }
  | {
      type: 'borrow';
      fromId: number;
      toId: number;
      parentId: number;
      upKey: number;
      downKey: number;
    }
  | { type: 'merge'; leftId: number; rightId: number; parentId: number; downKey: number }
  | { type: 'shrink-root'; nodeId: number };

export class BTree {
  readonly minDegree: number;
  root: BTreeNode;
  private nextId = 0;

  constructor(minDegree = 2) {
    if (!Number.isInteger(minDegree) || minDegree < 2 || minDegree > 8) {
      throw new RangeError(`最小次数は2以上8以下の整数: ${minDegree}`);
    }
    this.minDegree = minDegree;
    this.root = this.createNode();
  }

  private get maxKeys(): number {
    return 2 * this.minDegree - 1;
  }

  private createNode(): BTreeNode {
    return { id: this.nextId++, keys: [], children: [] };
  }

  search(key: number): BTreeEvent[] {
    const events: BTreeEvent[] = [];
    let node: BTreeNode | undefined = this.root;
    while (node) {
      events.push({ type: 'visit', nodeId: node.id, keys: [...node.keys] });
      let i = 0;
      while (i < node.keys.length && key > (node.keys[i] as number)) i++;
      if (i < node.keys.length && node.keys[i] === key) {
        events.push({ type: 'found', nodeId: node.id, key });
        return events;
      }
      if (node.children.length === 0) break;
      node = node.children[i];
    }
    events.push({ type: 'not-found', key });
    return events;
  }

  has(key: number): boolean {
    return this.search(key).some((e) => e.type === 'found');
  }

  insert(key: number): BTreeEvent[] {
    const events: BTreeEvent[] = [];
    if (this.root.keys.length === this.maxKeys) {
      const newRoot = this.createNode();
      newRoot.children.push(this.root);
      this.root = newRoot;
      events.push({ type: 'new-root', nodeId: newRoot.id });
      this.splitChild(newRoot, 0, events);
    }
    this.insertNonFull(this.root, key, events);
    return events;
  }

  // childrenの[index]が満杯のとき、中央キーを親へ上げて左右に分ける
  private splitChild(parent: BTreeNode, index: number, events: BTreeEvent[]): void {
    const left = parent.children[index] as BTreeNode;
    const right = this.createNode();
    const middleKey = left.keys[this.minDegree - 1] as number;
    right.keys = left.keys.splice(this.minDegree);
    left.keys.pop();
    if (left.children.length > 0) {
      right.children = left.children.splice(this.minDegree);
    }
    parent.keys.splice(index, 0, middleKey);
    parent.children.splice(index + 1, 0, right);
    events.push({
      type: 'split',
      parentId: parent.id,
      leftId: left.id,
      rightId: right.id,
      middleKey,
    });
  }

  private insertNonFull(node: BTreeNode, key: number, events: BTreeEvent[]): void {
    events.push({ type: 'visit', nodeId: node.id, keys: [...node.keys] });
    if (node.keys.includes(key)) {
      events.push({ type: 'duplicate', nodeId: node.id, key });
      return;
    }
    if (node.children.length === 0) {
      let i = node.keys.length - 1;
      while (i >= 0 && key < (node.keys[i] as number)) i--;
      node.keys.splice(i + 1, 0, key);
      events.push({ type: 'insert-key', nodeId: node.id, key });
      return;
    }
    let i = 0;
    while (i < node.keys.length && key > (node.keys[i] as number)) i++;
    let child = node.children[i] as BTreeNode;
    if (child.keys.length === this.maxKeys) {
      // 降りる前に満杯の子を割っておくと、再帰中に親へ戻る必要がなくなる
      this.splitChild(node, i, events);
      const lifted = node.keys[i] as number;
      if (key === lifted) {
        events.push({ type: 'duplicate', nodeId: node.id, key });
        return;
      }
      if (key > lifted) i++;
      child = node.children[i] as BTreeNode;
    }
    this.insertNonFull(child, key, events);
  }

  delete(key: number): BTreeEvent[] {
    const events: BTreeEvent[] = [];
    this.deleteFrom(this.root, key, events);
    if (this.root.keys.length === 0 && this.root.children.length === 1) {
      this.root = this.root.children[0] as BTreeNode;
      events.push({ type: 'shrink-root', nodeId: this.root.id });
    }
    return events;
  }

  // 呼び出し時、nodeは根であるかキーがt個以上あることを保証する
  private deleteFrom(node: BTreeNode, key: number, events: BTreeEvent[]): void {
    events.push({ type: 'visit', nodeId: node.id, keys: [...node.keys] });
    let i = 0;
    while (i < node.keys.length && key > (node.keys[i] as number)) i++;
    const isLeaf = node.children.length === 0;

    if (i < node.keys.length && node.keys[i] === key) {
      if (isLeaf) {
        node.keys.splice(i, 1);
        events.push({ type: 'remove-key', nodeId: node.id, key });
        return;
      }
      const left = node.children[i] as BTreeNode;
      const right = node.children[i + 1] as BTreeNode;
      if (left.keys.length >= this.minDegree) {
        const predecessor = this.maxKeyOf(left);
        node.keys[i] = predecessor;
        events.push({ type: 'replace-key', nodeId: node.id, oldKey: key, newKey: predecessor });
        this.deleteFrom(left, predecessor, events);
      } else if (right.keys.length >= this.minDegree) {
        const successor = this.minKeyOf(right);
        node.keys[i] = successor;
        events.push({ type: 'replace-key', nodeId: node.id, oldKey: key, newKey: successor });
        this.deleteFrom(right, successor, events);
      } else {
        this.mergeChildren(node, i, events);
        this.deleteFrom(left, key, events);
      }
      return;
    }

    if (isLeaf) {
      events.push({ type: 'not-found', key });
      return;
    }
    let child = node.children[i] as BTreeNode;
    if (child.keys.length < this.minDegree) {
      child = this.refill(node, i, events);
    }
    this.deleteFrom(child, key, events);
  }

  // キーがt-1個しかない子を、兄弟からの借用または統合でt個以上にする
  private refill(parent: BTreeNode, index: number, events: BTreeEvent[]): BTreeNode {
    const child = parent.children[index] as BTreeNode;
    const leftSibling = index > 0 ? (parent.children[index - 1] as BTreeNode) : undefined;
    const rightSibling =
      index < parent.children.length - 1 ? (parent.children[index + 1] as BTreeNode) : undefined;

    if (leftSibling && leftSibling.keys.length >= this.minDegree) {
      const downKey = parent.keys[index - 1] as number;
      const upKey = leftSibling.keys.pop() as number;
      child.keys.unshift(downKey);
      parent.keys[index - 1] = upKey;
      if (leftSibling.children.length > 0) {
        child.children.unshift(leftSibling.children.pop() as BTreeNode);
      }
      events.push({
        type: 'borrow',
        fromId: leftSibling.id,
        toId: child.id,
        parentId: parent.id,
        upKey,
        downKey,
      });
      return child;
    }
    if (rightSibling && rightSibling.keys.length >= this.minDegree) {
      const downKey = parent.keys[index] as number;
      const upKey = rightSibling.keys.shift() as number;
      child.keys.push(downKey);
      parent.keys[index] = upKey;
      if (rightSibling.children.length > 0) {
        child.children.push(rightSibling.children.shift() as BTreeNode);
      }
      events.push({
        type: 'borrow',
        fromId: rightSibling.id,
        toId: child.id,
        parentId: parent.id,
        upKey,
        downKey,
      });
      return child;
    }
    if (rightSibling) {
      this.mergeChildren(parent, index, events);
      return child;
    }
    this.mergeChildren(parent, index - 1, events);
    return parent.children[index - 1] as BTreeNode;
  }

  // 親のキー[index]を挟んで子[index]と子[index+1]を1ノードにまとめる
  private mergeChildren(parent: BTreeNode, index: number, events: BTreeEvent[]): void {
    const left = parent.children[index] as BTreeNode;
    const right = parent.children[index + 1] as BTreeNode;
    const downKey = parent.keys.splice(index, 1)[0] as number;
    left.keys.push(downKey, ...right.keys);
    left.children.push(...right.children);
    parent.children.splice(index + 1, 1);
    events.push({
      type: 'merge',
      leftId: left.id,
      rightId: right.id,
      parentId: parent.id,
      downKey,
    });
  }

  private maxKeyOf(node: BTreeNode): number {
    let current = node;
    while (current.children.length > 0) {
      current = current.children[current.children.length - 1] as BTreeNode;
    }
    return current.keys[current.keys.length - 1] as number;
  }

  private minKeyOf(node: BTreeNode): number {
    let current = node;
    while (current.children.length > 0) {
      current = current.children[0] as BTreeNode;
    }
    return current.keys[0] as number;
  }

  keys(): number[] {
    const result: number[] = [];
    const walk = (node: BTreeNode): void => {
      for (let i = 0; i < node.keys.length; i++) {
        if (node.children.length > 0) walk(node.children[i] as BTreeNode);
        result.push(node.keys[i] as number);
      }
      if (node.children.length > 0) walk(node.children[node.children.length - 1] as BTreeNode);
    };
    walk(this.root);
    return result;
  }

  get size(): number {
    return this.keys().length;
  }

  height(): number {
    let h = 1;
    let node = this.root;
    while (node.children.length > 0) {
      h++;
      node = node.children[0] as BTreeNode;
    }
    return h;
  }

  nodeCount(): number {
    const count = (node: BTreeNode): number =>
      1 + node.children.reduce((sum, child) => sum + count(child), 0);
    return count(this.root);
  }

  // B木の不変条件を検査し、違反を文字列で返す(テスト用)
  validate(): string[] {
    const errors: string[] = [];
    const leafDepths = new Set<number>();
    const t = this.minDegree;
    const check = (
      node: BTreeNode,
      depth: number,
      min: number,
      max: number,
      isRoot: boolean,
    ): void => {
      for (let i = 0; i < node.keys.length; i++) {
        const k = node.keys[i] as number;
        if (i > 0 && k <= (node.keys[i - 1] as number)) {
          errors.push(`ノード${node.id}: キーが昇順でない`);
        }
        if (k <= min || k >= max) {
          errors.push(`ノード${node.id}: キー${k}が範囲(${min}, ${max})を外れる`);
        }
      }
      if (!isRoot && node.keys.length < t - 1) {
        errors.push(`ノード${node.id}: キー数${node.keys.length}が下限${t - 1}未満`);
      }
      if (node.keys.length > 2 * t - 1) {
        errors.push(`ノード${node.id}: キー数${node.keys.length}が上限${2 * t - 1}超過`);
      }
      if (node.children.length === 0) {
        leafDepths.add(depth);
        return;
      }
      if (node.children.length !== node.keys.length + 1) {
        errors.push(`ノード${node.id}: 子数${node.children.length}がキー数+1でない`);
        return;
      }
      for (let i = 0; i < node.children.length; i++) {
        const lower = i === 0 ? min : (node.keys[i - 1] as number);
        const upper = i === node.keys.length ? max : (node.keys[i] as number);
        check(node.children[i] as BTreeNode, depth + 1, lower, upper, false);
      }
    };
    check(this.root, 0, -Infinity, Infinity, true);
    if (leafDepths.size > 1) {
      errors.push(`葉の深さが揃っていない: ${[...leafDepths].join(', ')}`);
    }
    return errors;
  }
}
