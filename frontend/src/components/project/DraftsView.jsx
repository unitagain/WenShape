import React, { useState, useEffect } from 'react';
import { draftsAPI } from '../../api';
import { Button, Card } from '../ui/core';
import { FileText, Trash2, Eye, EyeOff, BookOpen, Clock, ChevronRight, Sparkles, Drama } from 'lucide-react';

export function DraftsView({ projectId }) {
  const [chapters, setChapters] = useState([]);
  const [selectedChapter, setSelectedChapter] = useState('');
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadChapters();
  }, [projectId]);

  useEffect(() => {
    if (selectedChapter) loadChapterData();
  }, [selectedChapter]);

  useEffect(() => {
    if (selectedChapter && selectedVersion) loadDraftContent();
  }, [selectedChapter, selectedVersion]);

  const loadChapters = async () => {
    try {
      const resp = await draftsAPI.listChapters(projectId);
      const chapterList = Array.isArray(resp.data) ? resp.data : [];
      // Sort chapters by ID weight
      const sorted = sortChapters(chapterList);
      setChapters(sorted);
    } catch (e) {
      console.error(e);
    }
  };

  // Sort chapters using chapter ID rules
  const sortChapters = (chapterIds) => {
    const calculateWeight = (chapterId) => {
      const match = chapterId.match(/^(?:V(\d+))?C(\d+)(?:([EI])(\d+))?$/);
      if (!match) return 0;

      const volume = parseInt(match[1]) || 0;
      const chapter = parseInt(match[2]);
      const type = match[3];
      const seq = parseInt(match[4]) || 0;

      let weight = volume * 1000 + chapter;
      if (type && seq > 0) {
        weight += 0.1 * seq;
      }
      return weight;
    };

    return [...chapterIds].sort((a, b) => calculateWeight(a) - calculateWeight(b));
  };

  const getChapterIcon = (chapterId) => {
    if (chapterId.includes('E')) return <Sparkles size={14} className="text-amber-500" />;
    if (chapterId.includes('I')) return <Drama size={14} className="text-blue-500" />;
    return <BookOpen size={14} className="text-ink-600" />;
  };

  const loadChapterData = async () => {
    try {
      const vResp = await draftsAPI.listVersions(projectId, selectedChapter);
      const vItems = Array.isArray(vResp.data) ? vResp.data : [];
      setVersions(vItems);
      setSelectedVersion(vItems[vItems.length - 1] || '');

      try {
        const sResp = await draftsAPI.getSummary(projectId, selectedChapter);
        setSummary(sResp?.data || null);
      } catch {
        setSummary(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadDraftContent = async () => {
    setLoading(true);
    try {
      const dResp = await draftsAPI.getDraft(projectId, selectedChapter, selectedVersion);
      setDraftContent(dResp?.data?.content || '');
    } catch (e) {
      setDraftContent('Error loading content');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Sidebar List */}
      <div className="lg:col-span-3 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-lg font-bold text-ink-900">内容管理</h3>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
          {chapters.length === 0 && <div className="text-sm text-ink-400 p-2 italic">暂无章节</div>}
          {chapters.map((ch) => (
            <div
              key={ch}
              onClick={() => setSelectedChapter(ch)}
              className={`p-3 rounded-md border cursor-pointer transition-all text-sm flex items-center gap-2 ${selectedChapter === ch
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-surface border-border text-ink-600 hover:text-ink-900 hover:border-primary/30'
                }`}
            >
              {getChapterIcon(ch)}
              <span className="font-mono flex-1">{ch}</span>
              {selectedChapter === ch && <ChevronRight size={14} />}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:col-span-9 flex flex-col gap-6 overflow-hidden">
        {!selectedChapter ? (
          <div className="flex-1 flex items-center justify-center text-ink-400 border border-dashed border-border rounded-lg bg-surface/50">
            <div className="flex flex-col items-center">
              <FileText size={48} className="mb-4 opacity-20" />
              <span className="font-serif">选择章节查看详情</span>
            </div>
          </div>
        ) : (
          <>
            {/* Top Meta */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="md:col-span-2 bg-surface">
                <div className="p-4 border-b border-border bg-gray-50/50">
                  <h4 className="text-sm font-bold text-ink-900 flex items-center gap-2">
                    <BookOpen size={14} className="text-primary" /> 章节摘要
                  </h4>
                </div>
                <div className="p-4">
                  {summary ? (
                    <div className="space-y-2">
                      <div className="font-bold text-ink-900">{summary.title}</div>
                      <div className="text-sm text-ink-600 line-clamp-2 leading-relaxed">{summary.brief_summary}</div>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-400 italic">暂无摘要信息</span>
                  )}
                </div>
              </Card>

              <Card className="bg-surface">
                <div className="p-4 border-b border-border bg-gray-50/50">
                  <h4 className="text-sm font-bold text-ink-900 flex items-center gap-2">
                    <Clock size={14} className="text-primary" /> 版本历史
                  </h4>
                </div>
                <div className="p-4 space-y-3">
                  <select
                    className="w-full bg-background border border-border rounded p-2 text-sm text-ink-900 focus:outline-none focus:border-primary transition-colors cursor-pointer"
                    value={selectedVersion}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                  >
                    {versions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    onClick={async () => {
                      if (window.confirm(`确定要删除章节 ${selectedChapter} 吗？此操作不可撤销！`)) {
                        try {
                          await draftsAPI.deleteChapter(projectId, selectedChapter);
                          alert('章节已删除');
                          setSelectedChapter('');
                          setVersions([]);
                          setDraftContent('');
                          setSummary(null);
                          await loadChapters();
                        } catch (e) {
                          alert('删除失败: ' + e.message);
                        }
                      }
                    }}
                  >
                    <Trash2 size={12} className="mr-2" /> 删除章节
                  </Button>
                </div>
              </Card>
            </div>

            {/* Content Viewer */}
            <Card className="flex-1 overflow-hidden flex flex-col bg-surface shadow-paper">
              <div className="p-4 border-b border-border flex flex-row justify-between items-center bg-gray-50/30">
                <h4 className="text-sm font-bold text-ink-900">内容预览: <span className="font-mono font-normal ml-2 text-ink-500">{selectedVersion}</span></h4>
                <div className="text-xs font-mono text-ink-400">
                  {loading ? '加载中...' : `${draftContent.length} 字符`}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white">
                <div className="prose prose-slate max-w-none font-serif text-ink-900 leading-loose">
                  <pre className="whitespace-pre-wrap font-serif text-ink-900 bg-transparent p-0 border-0">
                    {draftContent}
                  </pre>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
