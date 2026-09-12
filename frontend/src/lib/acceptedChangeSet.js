export function projectAcceptedChapterContents(changes) {
  return Object.fromEntries(
    (Array.isArray(changes) ? changes : [])
      .filter((item) => item?.asset_type === 'chapter' && String(item.asset_id || '').trim())
      .map((item) => [String(item.asset_id), String(item.revised || '')]),
  );
}
