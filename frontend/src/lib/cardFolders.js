/**
 * 卡片文件夹（纯前端整理，不影响后端存储）。
 *
 * 卡片在后端只有类型与名称，没有目录概念。作者需要的是**视觉上的归拢**（类似资源管理器的
 * 分卷-章），因此文件夹只是一层本地视图状态：按项目存 localStorage，丢失不影响任何卡片数据。
 *
 * 纯函数、无 React、无副作用（除显式的 load/save）→ 可单元测试。
 */

const STORAGE_PREFIX = 'wenshape.cardFolders.';

/** 卡片在文件夹模型中的稳定键：后端无 id，用 类型:名称 唯一定位。 */
export const cardKeyOf = (card) => `${String(card?.type || '')}:${String(card?.name || '')}`;

export const emptyFolderState = () => ({ folders: [], assign: {} });

/** 归一化任意来源的数据，坏数据一律退化为空模型（视图状态，不值得为它报错）。 */
export const normalizeFolderState = (raw) => {
  const folders = Array.isArray(raw?.folders)
    ? raw.folders
        .filter((item) => item && typeof item === 'object' && String(item.id || '').trim())
        .map((item) => ({ id: String(item.id), name: String(item.name || '').trim() || String(item.id) }))
    : [];
  const ids = new Set(folders.map((item) => item.id));
  const assign = {};
  if (raw?.assign && typeof raw.assign === 'object') {
    for (const [key, value] of Object.entries(raw.assign)) {
      // 指向已删除文件夹的分配一并丢弃，避免卡片凭空消失。
      if (ids.has(String(value))) assign[String(key)] = String(value);
    }
  }
  return { folders, assign };
};

export const loadFolderState = (projectId) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !projectId) return emptyFolderState();
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    return raw ? normalizeFolderState(JSON.parse(raw)) : emptyFolderState();
  } catch {
    return emptyFolderState();
  }
};

export const saveFolderState = (projectId, state) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !projectId) return;
    window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(normalizeFolderState(state)));
  } catch {
    /* 视图状态，写不进去也不影响卡片本身 */
  }
};

export const createFolder = (state, name, id) => {
  const clean = String(name || '').trim();
  if (!clean) return state;
  const folderId = String(id || `f${Date.now().toString(36)}`);
  return { ...state, folders: [...state.folders, { id: folderId, name: clean }] };
};

export const renameFolder = (state, folderId, name) => {
  const clean = String(name || '').trim();
  if (!clean) return state;
  return {
    ...state,
    folders: state.folders.map((item) => (item.id === folderId ? { ...item, name: clean } : item)),
  };
};

/** 删除文件夹：其中的卡片回到「未分组」，绝不连带删除卡片。 */
export const deleteFolder = (state, folderId) => {
  const assign = {};
  for (const [key, value] of Object.entries(state.assign || {})) {
    if (value !== folderId) assign[key] = value;
  }
  return { folders: state.folders.filter((item) => item.id !== folderId), assign };
};

/** 分配卡片到文件夹；folderId 为空表示移出到「未分组」。 */
export const assignCard = (state, cardKey, folderId) => {
  const assign = { ...(state.assign || {}) };
  if (folderId) assign[cardKey] = String(folderId);
  else delete assign[cardKey];
  return { ...state, assign };
};

/**
 * 按文件夹分组；未分组永远排在最后，空文件夹仍然显示（否则新建后立刻消失，无法拖入）。
 */
export const groupCards = (cards = [], state = emptyFolderState()) => {
  const assign = state.assign || {};
  const buckets = new Map(state.folders.map((folder) => [folder.id, []]));
  const ungrouped = [];
  for (const card of cards) {
    const folderId = assign[cardKeyOf(card)];
    if (folderId && buckets.has(folderId)) buckets.get(folderId).push(card);
    else ungrouped.push(card);
  }
  const groups = state.folders.map((folder) => ({ folder, cards: buckets.get(folder.id) || [] }));
  groups.push({ folder: null, cards: ungrouped });
  return groups;
};
