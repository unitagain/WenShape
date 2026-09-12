/**
 * 轻量 Markdown 解析（无依赖）。
 *
 * Agent 的最终答复常带 `##` 标题、`-` 列表与 `**强调**`。此前按纯文本渲染，
 * 这些标记按字面显示，整段读起来是一堵墙（负责人反馈：排版问题）。
 *
 * 刻意不引 react-markdown：只需覆盖模型实际会用的子集，且渲染层用 React 元素而非
 * dangerouslySetInnerHTML——不解析 HTML，就没有注入面。
 *
 * 纯函数、无 React → 可单元测试。
 */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
// 分隔符后允许无空格（中文常写「2、第二条」「1.第一条」）；用 (?!\d) 排除小数（如 3.14）。
const ORDERED_RE = /^\s*(\d{1,3})[.、)]\s*(?!\d)(.*\S.*)$/;
const RULE_RE = /^\s*([-*_])\1{2,}\s*$/;

/** 行内片段：普通文本 / 粗体 / 行内代码。未闭合的标记按普通文本处理。 */
export function parseInline(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const parts = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let cursor = 0;
  let match = pattern.exec(source);
  while (match) {
    if (match.index > cursor) parts.push({ type: 'text', text: source.slice(cursor, match.index) });
    if (match[1] !== undefined) parts.push({ type: 'bold', text: match[1] });
    else parts.push({ type: 'code', text: match[2] });
    cursor = match.index + match[0].length;
    match = pattern.exec(source);
  }
  if (cursor < source.length) parts.push({ type: 'text', text: source.slice(cursor) });
  return parts;
}

/**
 * 按块解析：heading / list / rule / paragraph。
 * 连续的同类列表项合并为一个 list 块；空行分段。
 */
export function parseMarkdownBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    const joined = paragraph.join('\n').trim();
    if (joined) blocks.push({ type: 'paragraph', text: joined });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = String(raw ?? '');
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (RULE_RE.test(line)) {
      flushAll();
      blocks.push({ type: 'rule' });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { type: 'list', ordered: true, items: [] };
      }
      list.items.push(ordered[2].trim());
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { type: 'list', ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}

/** 文本中是否出现值得渲染的 Markdown 结构（否则走原有纯文本路径，零风险）。 */
export function hasMarkdownStructure(text) {
  const blocks = parseMarkdownBlocks(text);
  return blocks.some((block) => block.type !== 'paragraph') || /\*\*[^*]+\*\*|`[^`]+`/.test(String(text ?? ''));
}
