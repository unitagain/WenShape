export const buildLineDiff = (originalText = '', revisedText = '', options = {}) => {
  const contextLines = options.contextLines ?? 2;
  const normalize = (text) => (text || '').replace(/\r\n/g, '\n');

  const originalLines = normalize(originalText).split('\n');
  const revisedLines = normalize(revisedText).split('\n');

  const lcs = buildLcsMatrix(originalLines, revisedLines);
  let ops = buildDiffOps(originalLines, revisedLines, lcs);

  let { hunks, stats } = buildHunksFromOps(ops, contextLines);
  const applied = applyDiffOpsWithDecisions(originalLines, ops, {});
  if (normalize(applied) !== normalize(revisedText)) {
    // Fallback: split changes into separate hunks, not all into hunk-1
    // 分组策略：delete 块为一组，add 块为一组，避免将所有改动放在同一个 hunk
    const fallbackOps = [];
    let hunkCounter = 0;

    // Group 1: All deletes from original
    if (originalLines.length > 0) {
      hunkCounter += 1;
      originalLines.forEach((line) => {
        fallbackOps.push({ type: 'delete', content: line, hunkId: `hunk-${hunkCounter}` });
      });
    }

    // Group 2: All adds from revised
    if (revisedLines.length > 0) {
      hunkCounter += 1;
      revisedLines.forEach((line) => {
        fallbackOps.push({ type: 'add', content: line, hunkId: `hunk-${hunkCounter}` });
      });
    }

    ops = fallbackOps;
    ({ hunks, stats } = buildHunksFromOps(ops, contextLines));
  }

  return {
    originalLines,
    revisedLines,
    ops,
    hunks,
    stats,
  };
};

export const applyDiffOpsWithDecisions = (_originalLines = [], ops = [], decisions = {}) => {
  const result = [];
  for (const op of ops) {
    if (op.type === 'context') {
      result.push(op.content);
      continue;
    }

    const decision = decisions[op.hunkId] || 'accepted';
    if (op.type === 'add') {
      if (decision === 'accepted') {
        result.push(op.content);
      }
      continue;
    }

    if (op.type === 'delete') {
      if (decision === 'rejected' || decision === 'pending') {
        result.push(op.content);
      }
    }
  }

  return result.join('\n');
};

const buildLcsMatrix = (a, b) => {
  const rows = a.length;
  const cols = b.length;
  const matrix = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  return matrix;
};

const buildDiffOps = (originalLines, revisedLines, lcs) => {
  const ops = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length && j < revisedLines.length) {
    if (originalLines[i] === revisedLines[j]) {
      ops.push({ type: 'context', content: originalLines[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'delete', content: originalLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', content: revisedLines[j] });
      j += 1;
    }
  }

  while (i < originalLines.length) {
    ops.push({ type: 'delete', content: originalLines[i] });
    i += 1;
  }

  while (j < revisedLines.length) {
    ops.push({ type: 'add', content: revisedLines[j] });
    j += 1;
  }

  return ops;
};

const buildHunksFromOps = (ops, contextLines) => {
  const hunks = [];
  const stats = { additions: 0, deletions: 0 };
  let pending = null;
  let hunkId = 0;
  let preContext = [];

  const flushPending = () => {
    if (!pending) return;
    hunks.push(pending);
    pending = null;
  };

  ops.forEach((op) => {
    if (op.type === 'add') stats.additions += 1;
    if (op.type === 'delete') stats.deletions += 1;

    if (op.type === 'context') {
      if (pending) {
        pending.trailingContext += 1;
        if (pending.trailingContext >= contextLines) {
          flushPending();
          preContext = [op];
        } else {
          pending.changes.push(op);
        }
      } else {
        preContext.push(op);
        if (preContext.length > contextLines) {
          preContext.shift();
        }
      }
      return;
    }

    // 遇到新的变更行：如果当前 hunk 已有 trailing context，说明中间有间隔，切分新 hunk
    if (pending && pending.trailingContext > 0) {
      flushPending();
    }

    if (!pending) {
      pending = {
        id: `hunk-${(hunkId += 1)}`,
        changes: [...preContext],
        trailingContext: 0,
      };
      preContext = [];
    }

    op.hunkId = pending.id;
    pending.changes.push(op);
    pending.trailingContext = 0;
  });

  flushPending();

  return { hunks, stats };
};

/**
 * 按资产合并两个 change set（后者优先），用于计划多步执行时累积待批准文件。
 *
 * plan 每一步的 stream_end 各带自己的 change_set，而 diffReview 是整体替换；
 * 不合并的话先完成的章节会从待批准列表里消失（作者只能看到最后一个，
 * 或采纳当前项后才看到下一个）。以 `asset_type:asset_id` 去重并保持原有顺序，
 * 同一资产保留较新的一份——后一步基于前一步的 working 副本继续改。
 */
export const mergeChangeSets = (previous = [], next = []) => {
  const merged = [];
  const indexByKey = new Map();
  for (const item of [...(previous || []), ...(next || [])]) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.asset_type || ''}:${item.asset_id || ''}`;
    if (indexByKey.has(key)) {
      merged[indexByKey.get(key)] = item;
      continue;
    }
    indexByKey.set(key, merged.length);
    merged.push(item);
  }
  return merged;
};
