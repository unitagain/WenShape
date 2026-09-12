/**
 * 章节正文基线的「未知 / 已知」语义（U10-A1）。
 *
 * 核心不变量：**未知 ≠ 空**。
 * 缓存里没有某章的条目，只说明本会话没加载过它，不代表磁盘上那一章是空的。
 * 历史缺陷正是把 `undefined` 兜底成 `''`，再把这个伪造出来的空串当作权威原文
 * 写回缓存；切章时它被当成已知内容采用，SWR 回填被挡住，最后由 autosave
 * 覆盖磁盘上的真实正文——一次多章写作就能清空没被打开过的章节。
 *
 * 因此这里所有入口都遵守同一条规则：**拿不准就不写**，把「未知」原样保留下来，
 * 交给服务端加载真实正文，而不是就地猜一个空串。
 */

/**
 * 基线是否已知。只有明确的字符串才算已知；undefined / null 一律是未知。
 * 注意空串是「已知为空」（用户真的清空过这一章），与「未知」不是一回事。
 */
export function isKnownBaseline(value) {
  return typeof value === 'string';
}

/**
 * 播种基线快照。value 未知时**不写入**，保持该章「未知」而不是伪造成空串。
 *
 * @returns {boolean} 是否真的写入了基线。调用方据此决定能否安全地把正文置空
 *                    ——只有基线已知，置空才是可还原的。
 */
export function seedBaseline(store, key, value) {
  if (!store || !key) return false;
  if (!isKnownBaseline(value)) return false;
  store[key] = String(value);
  return true;
}

/** 读取基线；未播种时返回 undefined（未知），绝不返回空串。 */
export function readBaseline(store, key) {
  if (!store || !key) return undefined;
  const value = store[key];
  return isKnownBaseline(value) ? value : undefined;
}

/**
 * 解析 diff 基线，按可信度取值：
 *   1. change_set 中该资产的 `original` —— 后端给出的权威原文，最可信；
 *   2. 本地播种的流式前快照；
 *   3. 都没有 → undefined（未知），调用方必须据此跳过缓存写入。
 */
export function resolveDiffBaseline({ changeSet, assetId, store, key } = {}) {
  const changes = Array.isArray(changeSet) ? changeSet : [];
  const target = String(assetId || '');
  const authoritative = changes.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      String(item.asset_type || 'chapter') === 'chapter' &&
      String(item.asset_id || '') === target &&
      isKnownBaseline(item.original),
  );
  if (authoritative) return String(authoritative.original);
  return readBaseline(store, key || target);
}

/**
 * 是否属于「以空覆盖已知非空」的破坏性写入。
 * 只看内容本身，不区分来源——来源判断交给 shouldBlockEmptyAutosave。
 */
export function isDestructiveEmptyWrite(next, lastKnown) {
  return String(next ?? '').trim() === '' && isKnownBaseline(lastKnown) && lastKnown.trim() !== '';
}

/**
 * autosave 是否应当拦截这次空内容写入。
 *
 * 作者主动清空章节是**合法操作**，不能一并禁掉；能区分两者的唯一可靠信号是
 * 「这次的空内容是不是本章最近一次用户输入的结果」：
 *   - 作者全选删除 → lastUserInput 记到同一章的空内容 → 放行；
 *   - 缓存/基线缺陷 → 正文凭空变空，与用户最后一次输入对不上 → 拦截。
 * 用「编辑过本章」这类粗粒度标记不行——那会让该章此后永久失去保护。
 */
export function shouldBlockEmptyAutosave({ next, lastKnown, lastUserInput, chapter } = {}) {
  if (!isDestructiveEmptyWrite(next, lastKnown)) return false;
  const authored =
    Boolean(lastUserInput) &&
    String(lastUserInput.chapter || '') === String(chapter || '') &&
    lastUserInput.content === next;
  return !authored;
}

/**
 * 从 change_set 中取出所有需要播种基线的章节资产。
 * 多资产 turn 里每个章节都要各自播种，只播种 primary 会让其余章节落回「未知」。
 */
export function chapterBaselineEntries(changeSet) {
  const changes = Array.isArray(changeSet) ? changeSet : [];
  const entries = [];
  for (const item of changes) {
    if (!item || typeof item !== 'object') continue;
    if (String(item.asset_type || 'chapter') !== 'chapter') continue;
    const id = String(item.asset_id || '');
    if (!id || !isKnownBaseline(item.original)) continue;
    entries.push([id, String(item.original)]);
  }
  return entries;
}
