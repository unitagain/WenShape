import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { sessionAPI } from '../../api';
import { extractErrorDetail } from '../../utils/extractError';

const labels = { pending: '待写入', already_applied: '已写入', conflict: '正文已变化', error: '无法核对' };

/** 中断批次由作者查看原文/目标后确认续做；不会自动恢复或回滚。 */
export default function ChangeSetRecovery({ projectId, disabled = false, onRecovered }) {
  const { data, error, mutate } = useSWR(
    projectId ? ['change-set-recovery', projectId] : null,
    async () => (await sessionAPI.pendingChangeSets(projectId)).data,
  );
  const [reviewing, setReviewing] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const journals = Array.isArray(data?.journals) ? data.journals : [];

  const perform = async (journal, resume) => {
    if (busy || disabled) return;
    setBusy(true);
    setFailure('');
    try {
      const response = resume
        ? await sessionAPI.resumeChangeSet(projectId, journal.journal_id)
        : await sessionAPI.discardChangeSet(projectId, journal.journal_id);
      if (!mounted.current) return;
      if (resume) await onRecovered?.(journal.assets);
      if (!response.data?.success) {
        throw new Error(response.data?.reason === 'resume_revision_conflict'
          ? '正文已变化，续做已停止，请核对最新内容。' : '未能完成操作，请重试或核对文件。');
      }
      setReviewing('');
    } catch (err) {
      setFailure(extractErrorDetail(err));
    } finally {
      try {
        await mutate();
      } catch (err) {
        if (mounted.current) setFailure(extractErrorDetail(err));
      } finally {
        if (mounted.current) setBusy(false);
      }
    }
  };

  if (!journals.length && !error && !failure) return null;
  return (
    <aside aria-label="中断写入恢复" className="border-b border-amber-500/40 bg-[var(--vscode-input-bg)] p-3 text-xs">
      {(error || failure) && <p role="alert">{failure || '无法查询中断写入，请稍后重试。'}</p>}
      {journals.map((journal) => {
        const assets = journal.assets || [];
        const conflict = assets.some((asset) => !['pending', 'already_applied'].includes(asset.check?.result));
        return (
          <div key={journal.journal_id} className="space-y-2">
            <p>上次写入尚未完成，涉及 {assets.length} 个文件。已写入内容会保留。</p>
            <button type="button" onClick={() => setReviewing(journal.journal_id)}>查看恢复预览</button>
            {reviewing === journal.journal_id && (
              <div className="space-y-2">
                {assets.map((asset) => (
                  <details key={`${asset.asset_type}:${asset.asset_id}`}>
                    <summary>{asset.asset_id} · {labels[asset.check?.result] || '无法核对'}</summary>
                    <p>原文</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{asset.original}</pre>
                    <p>待写入内容</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{asset.revised}</pre>
                  </details>
                ))}
                {conflict && <p role="alert">存在内容冲突或缺失材料，不能继续写入。</p>}
                {disabled && <p>请先完成当前任务并保存编辑内容。</p>}
                <div className="flex gap-4">
                  <button type="button" disabled={busy || disabled || conflict} onClick={() => perform(journal, true)}>
                    确认继续写入
                  </button>
                  <button type="button" disabled={busy || disabled} onClick={() => perform(journal, false)}>
                    放弃剩余写入
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
