/** 固定选区所属章节、完整来源版本与 Unicode 字符范围。 */
export async function buildChatSelection(candidate, chapter, currentText) {
  if (!candidate?.text) return { has_selection: false, selection_text: '' };
  const source = String(candidate.sourceText ?? '');
  if (candidate.chapter !== chapter || source !== currentText || source.slice(candidate.start, candidate.end) !== candidate.text) {
    throw new Error('选区所属章节或正文已变化，请重新选择后发送。');
  }
  if (Array.from(candidate.text).length > 200000) {
    throw new Error('选区超过 20 万字符，请缩小选区后发送。');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return {
    has_selection: true,
    selection_text: candidate.text,
    selection: {
      chapter,
      source_sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
      // textarea 使用 UTF-16，Python 切片使用 Unicode code point。
      start: Array.from(source.slice(0, candidate.start)).length,
      end: Array.from(source.slice(0, candidate.end)).length,
    },
  };
}
