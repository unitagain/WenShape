/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import useSWR, { mutate as mutateSWR } from 'swr';
import { useParams } from 'react-router-dom';
import { sessionAPI, draftsAPI, cardsAPI, projectsAPI, volumesAPI, configAPI, memoryPackAPI } from '../api';
import { Save } from 'lucide-react';
import { ChapterCreateDialog } from '../components/project/ChapterCreateDialog';
import { IDELayout } from '../components/ide/IDELayout';
import { IDEProvider } from '../context/IDEContext';
import { useIDE } from '../context/IDEContext';
import AnalysisReviewDialog from '../components/writing/AnalysisReviewDialog';
import WritingSessionAgentPanel from '../components/writing/WritingSessionAgentPanel';
import WritingSessionMainContent from '../components/writing/WritingSessionMainContent';
import ChangeSetRecovery from '../components/writing/ChangeSetRecovery';
import { buildLineDiff, applyDiffOpsWithDecisions, mergeChangeSets } from '../lib/diffUtils';
import SaveMenu from '../components/writing/SaveMenu';
import logger from '../utils/logger';
import { extractErrorDetail } from '../utils/extractError';
import { useLocale } from '../i18n';
import { getDialogMaxCharsPreference } from '../components/ide/TitleBar';
import { useWritingSessionRealtime } from '../hooks/useWritingSessionRealtime';
import {
  normalizeClarificationQuestionsFromResponse,
  normalizeChatTurnResponse,
  shouldRecoverChangedTurn,
  terminalStateMessage,
} from '../features/agent/model/agentProtocol';
import { mergeWritingMemoryStatus, shouldShowWritingMemory } from '../features/agent/model/writingMemory';
import { appendAgentProgressEvent } from '../lib/agentProgress';
import { createLatestTaskQueue } from '../lib/latestTaskQueue';
import { documentOf, tabKeyOf } from '../lib/editorTabs';
import { projectAcceptedChapterContents } from '../lib/acceptedChangeSet';
import { buildChatSelection } from '../lib/chatSelection';
import {
  chapterBaselineEntries,
  isKnownBaseline,
  readBaseline,
  resolveDiffBaseline,
  seedBaseline,
  shouldBlockEmptyAutosave,
} from '../lib/chapterBaseline';
import {
  canSendKeepaliveDraft,
  clearDraftRecovery,
  readDraftRecovery,
  resolveDraftRecovery,
  writeDraftRecovery,
} from '../lib/draftRecovery';
import {
  canAutosaveLoadedChapter,
  lastChapterStorageKey,
  resolveRestoredChapter,
  shouldApplyLoadedChapter,
} from '../lib/chapterHydration';
import {
  fetchChapterContent,
  countWords,
  getSelectionStats,
  normalizeStars,
  parseListInput,
  formatListInput,
} from '../utils/writingSessionHelpers';

/**
 * WritingSessionContent - 写作会话主流程组件
 *
 * 统一的写作 IDE 界面，集成 AI 写作、编辑、分析等功能。
 * 使用 IDE Layout 提供三段式布局（活动栏、左侧面板、编辑区、右侧面板、底部状态栏）。
 *
 * 主要功能：
 * - 实时 WebSocket 连接管理和消息处理
 * - 章节内容编辑和版本管理
 * - AI 驱动的写作、编辑、分析建议
 * - 交互式对话和反馈流程
 * - 草稿保存和历史记录
 *
 * @component
 * @returns {JSX.Element} 写作会话主界面
 */
function WritingSessionContent() {
  const { t, locale } = useLocale();
  const requestLanguage = locale === 'en-US' ? 'en' : 'zh';
  const { projectId } = useParams();
  const { state, dispatch, saveTargets } = useIDE();

  // ========================================================================
  // 项目和会话基本信息 / Project and Session Information
  // ========================================================================
  // 项目数据状态 / Project data from API
  const [project, setProject] = useState(null);
  const writingLanguage = project?.language === 'en' ? 'en' : 'zh';
  const prevProjectIdRef = useRef(null);
  const chatHydratedRef = useRef(null);

  useEffect(() => {
    if (projectId) {
      projectsAPI.get(projectId).then((res) => setProject(res.data));
      dispatch({ type: 'SET_PROJECT_ID', payload: projectId });
    }
  }, [projectId, dispatch]);

  // 项目切换时清理所有会话状态，防止数据污染
  // 使用 useRef 判断 projectId 是否真正变化，避免不必要的清理
  useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      // 项目真正切换了：清理所有写作会话状态
      setDiffReview(null);
      setDiffDecisions({});
      setManualContent('');
      setManualContentByChapter({});
      setChapters([]);
      setMessagesByChapter({});
      setProgressEventsByChapter({});
      setChapterInfo({ chapter: null, chapter_title: null, content: null });
      setStatus('idle');
      setSelectionInfo({ start: 0, end: 0, text: '' });
      setAttachedSelection(null);
      setEditScope('document');
      setWritingMemoryTurn(null);
      setCanonTurnState(null);
      // 标签是会话内资产：换项目等于换工作区，连同视图位置一起丢弃。
      dispatch({ type: 'CLOSE_ALL_TABS' });
      viewStateByChapterRef.current = {};
      if (streamingRef.current?.timer) {
        streamingRef.current.timer();
      }
      streamingRef.current = null;
      setStreamingState({ active: false, progress: 0, current: 0, total: 0 });
    }
    prevProjectIdRef.current = projectId;
  }, [dispatch, projectId]);

  // UI State
  const [showChapterDialog, setShowChapterDialog] = useState(false);
  const [chapters, setChapters] = useState([]);

  // Save/Analyze UI
  const [isSaving, setIsSaving] = useState(false);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [analysisItems, setAnalysisItems] = useState([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisSaving, setAnalysisSaving] = useState(false);

  // Proposal State
  // Logic State
  const [status, setStatus] = useState('idle'); // idle, starting, editing, waiting_feedback, completed
  const [messagesByChapter, setMessagesByChapter] = useState({});
  const [progressEventsByChapter, setProgressEventsByChapter] = useState({});
  const [manualContent, setManualContent] = useState(''); // Textarea content
  const [manualContentByChapter, setManualContentByChapter] = useState({});
  const [selectionInfo, setSelectionInfo] = useState({ start: 0, end: 0, text: '' });
  const [attachedSelection, setAttachedSelection] = useState(null); // { start, end, text }
  const [editScope, setEditScope] = useState('document'); // document | selection
  const [dialogMaxChars, setDialogMaxChars] = useState(getDialogMaxCharsPreference);
  const [diffReview, setDiffReview] = useState(null);
  const [diffDecisions, setDiffDecisions] = useState({});
  const lastGeneratedByChapterRef = useRef({});
  const streamBufferByChapterRef = useRef({});
  const streamTextByChapterRef = useRef({});
  const streamFlushRafByChapterRef = useRef({});
  const serverStreamActiveRef = useRef(false);
  const serverStreamUsedRef = useRef(false);
  const streamingChapterKeyRef = useRef(null);
  const streamOriginalByChapterRef = useRef({}); // 流式前各章原文快照，用于结束时生成 diff 提议
  const autosaveTimerRef = useRef(null);
  const autosaveRetryTimerRef = useRef(null);
  const autosaveLastPayloadRef = useRef({ chapter: null, content: null, title: null });
  // 本章最近一次「用户亲手输入」的结果。autosave 的空内容护栏据此放行作者的主动清空，
  // 同时拦住缓存/基线缺陷造成的凭空变空（U10-A1）。
  const lastUserInputRef = useRef({ chapter: null, content: null });
  const latestAutosavePayloadRef = useRef(null);
  const autosaveWorkerRef = useRef(null);
  const autosaveQueueRef = useRef(null);
  const canonSyncPendingRef = useRef(new Map());
  const canonSyncInFlightRef = useRef(new Map());
  const backupRequiredRef = useRef(new Set());

  // 编辑器视图位置记忆：{ [chapterKey]: { scrollTop, selectionStart, selectionEnd } }。
  // 与 manualContentByChapter 同生命周期（会话内、随标签关闭回收），刻意不落盘。
  const editorRef = useRef(null);
  const viewStateByChapterRef = useRef({});
  // 当前 textarea 已经按哪一章摆好位置；未摆位前不得回写位置，否则会把刚挂载的 0 当成用户位置。
  const restoredKeyRef = useRef(null);
  const [viewRestoreKey, setViewRestoreKey] = useState(null);

  // Writer 反问：内联渲染在对话流中（U5），不再使用全屏 modal。
  // showPreWriteDialog 表示「当前有一张待回答的反问卡」；resolved 后转为只读摘要保留在历史里。
  const [showPreWriteDialog, setShowPreWriteDialog] = useState(false);
  const [preWriteQuestions, setPreWriteQuestions] = useState([]);
  const [clarificationMeta, setClarificationMeta] = useState(null);
  const [clarificationResolved, setClarificationResolved] = useState(null);
  const [pendingChatPrompt, setPendingChatPrompt] = useState(null);
  const activeChatPromptRef = useRef(null);
  const activeClarificationKeyRef = useRef('');
  const resolvedClarificationKeysRef = useRef(new Set());

  useEffect(() => {
    const onDialogMaxCharsChanged = (event) => {
      const next = Number(event?.detail);
      setDialogMaxChars(next === 6000 ? 6000 : 2000);
    };
    const onStorage = (event) => {
      if (event?.key !== 'wenshape_dialog_max_chars') return;
      const next = Number(event?.newValue);
      setDialogMaxChars(next === 6000 ? 6000 : 2000);
    };
    window.addEventListener('wenshape:dialog-max-chars', onDialogMaxCharsChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('wenshape:dialog-max-chars', onDialogMaxCharsChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const manualContentByChapterRef = useRef(manualContentByChapter);
  const manualContentRef = useRef(manualContent);
  useEffect(() => {
    manualContentByChapterRef.current = manualContentByChapter;
  }, [manualContentByChapter]);
  useEffect(() => {
    manualContentRef.current = manualContent;
  }, [manualContent]);

  // 轻提示（不打断、不强跳转）
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const pushNotice = useCallback((text) => {
    if (!text) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setNotice({ id, text: String(text) });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);
  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // WebSocket
  const wsRef = useRef(null);
  const traceWsRef = useRef(null);
  const wsStatusRef = useRef('disconnected');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const streamingRef = useRef(null);
  const chatRecoveryTimerRef = useRef(null);
  const [streamingState, setStreamingState] = useState({
    active: false,
    progress: 0,
    current: 0,
    total: 0,
  });
  useEffect(() => {
    return () => {
      if (chatRecoveryTimerRef.current) window.clearTimeout(chatRecoveryTimerRef.current);
    };
  }, []);

  // Trace Events for AgentTimeline
  const [traceEvents, setTraceEvents] = useState([]);
  const [agentTraces, setAgentTraces] = useState([]);

  // Chapter Info
  const [chapterInfo, setChapterInfo] = useState({
    chapter: null,
    chapter_title: null,
    content: null,
  });

  const NO_CHAPTER_KEY = '__no_chapter__';
  const activeChapterKey = chapterInfo.chapter ? String(chapterInfo.chapter) : NO_CHAPTER_KEY;

  const activeChapterKeyRef = useRef(activeChapterKey);
  const chapterInfoRef = useRef(chapterInfo);
  const chapterLoadStateRef = useRef({ chapter: NO_CHAPTER_KEY, ready: false });
  const unsavedChangesRef = useRef(state.unsavedChanges);
  useEffect(() => {
    activeChapterKeyRef.current = activeChapterKey;
  }, [activeChapterKey]);
  useEffect(() => {
    chapterInfoRef.current = chapterInfo;
  }, [chapterInfo]);
  useEffect(() => {
    unsavedChangesRef.current = state.unsavedChanges;
  }, [state.unsavedChanges]);

  // Agent mode (for AgentStatusPanel)
  const [agentMode, setAgentMode] = useState('create'); // 'create' | 'edit'

  const agentBusy =
    Boolean(diffReview) ||
    status === 'starting' ||
    status === 'waiting_user_input' ||
    isGenerating ||
    streamingState.active;

  const isStreamingForActiveChapter = streamingState.active && streamingChapterKeyRef.current === activeChapterKey;

  const isDiffReviewForActiveChapter = Boolean(diffReview) && String(diffReview?.chapterKey || '') === activeChapterKey;

  const canUseWriter = countWords(manualContent, writingLanguage) === 0;

  // 对话以「项目」为单位（而非章节）：整个项目一份长青对话，AI 的撰写/编辑动作仍作用于当前激活章节。
  const projectChatKey = String(projectId || '');
  const messages = useMemo(() => messagesByChapter[projectChatKey] || [], [messagesByChapter, projectChatKey]);
  const progressEvents = useMemo(
    () => progressEventsByChapter[projectChatKey] || [],
    [progressEventsByChapter, projectChatKey],
  );

  // 深度思考开关：仅当「写作角色」绑定的模型支持参数级 thinking 切换时，对话栏才显示按钮（能力门控）。
  const { data: llmProfilesData } = useSWR('llm-profiles', () => configAPI.getProfiles().then((r) => r.data), {
    revalidateOnFocus: false,
  });
  const { data: agentAssignmentsData } = useSWR(
    'agent-assignments',
    () => configAPI.getAssignments().then((r) => r.data),
    { revalidateOnFocus: false },
  );
  const writerProfileId = agentAssignmentsData?.writer;
  const writerProfile = Array.isArray(llmProfilesData)
    ? llmProfilesData.find((profile) => profile?.id === writerProfileId)
    : null;
  const reasoningCapability = writerProfile?.reasoning_capability || null;
  const agentMention = writerProfile?.provider && writerProfile.provider !== 'custom' ? writerProfile.provider : 'Agent';
  const reasoningCanDisable = reasoningCapability?.can_disable !== false;
  const reasoningLevels = useMemo(
    () => {
      const raw = Array.isArray(reasoningCapability?.levels) ? reasoningCapability.levels : [];
      const explicit = raw.filter((level) => level !== 'auto');
      if (reasoningCanDisable && !explicit.includes('off')) explicit.unshift('off');
      return explicit.length ? explicit : ['off'];
    },
    [reasoningCanDisable, reasoningCapability?.levels],
  );
  const [reasoningLevel, setReasoningLevel] = useState('off');
  useEffect(() => {
    const storageKey = `wenshape_reasoning_level_${writerProfileId || 'default'}`;
    const capabilityDefault = String(reasoningCapability?.default_level || 'high');
    const defaultLevel = reasoningCanDisable
      ? 'off'
      : reasoningLevels.includes(capabilityDefault)
        ? capabilityDefault
        : reasoningLevels[0];
    let stored = defaultLevel;
    try {
      stored = window.localStorage.getItem(storageKey) || defaultLevel;
    } catch {
      stored = defaultLevel;
    }
    setReasoningLevel(reasoningLevels.includes(stored) ? stored : defaultLevel);
  }, [writerProfileId, reasoningCanDisable, reasoningCapability?.default_level, reasoningLevels]);
  const handleReasoningLevelChange = useCallback(
    (level) => {
      if (!reasoningLevels.includes(level)) return;
      setReasoningLevel(level);
      try {
        window.localStorage.setItem(`wenshape_reasoning_level_${writerProfileId || 'default'}`, level);
      } catch {
        /* ignore storage failures */
      }
    },
    [reasoningLevels, writerProfileId],
  );
  // 待执行的 plan（仿 Claude Code：生成后展示步骤 + 等用户「执行」批准；执行走串行编排器）。
  const [pendingPlan, setPendingPlan] = useState(null);
  const [planExecuting, setPlanExecuting] = useState(false);
  // 计划执行期间每一步的 stream_end 各带自己的 change_set。diffReview 是整体替换，
  // 逐步覆盖会让先完成的章节从待批准列表里消失（作者只能看到最后一个，或采纳后才见下一个）。
  // 故 plan 执行期间按资产合并而非替换；单轮对话仍用替换，避免复活上一轮的陈旧提案。
  const planExecutingRef = useRef(false);
  useEffect(() => {
    planExecutingRef.current = planExecuting;
  }, [planExecuting]);

  // 面板「生成中」只看真实执行信号。待审阅的 diff 是**等作者决策**的状态而非 Agent 在工作；
  // 把它算进去会导致任务全部完成后仍一直转圈，直到采纳 diff 才停（负责人反馈 4）。
  // agentBusy 本身另有用途（SWR 轮询间隔、自动保存保护），保持原语义不动。
  const agentGenerating =
    status === 'starting' ||
    status === 'waiting_user_input' ||
    isGenerating ||
    streamingState.active ||
    planExecuting;

  // 计划执行进度：后端 plan_step 事件已带 step_id（PR-1 放行白名单），取最近一条即当前步。
  const planActiveStepId = useMemo(() => {
    if (!planExecuting) return null;
    for (let i = progressEvents.length - 1; i >= 0; i -= 1) {
      const event = progressEvents[i];
      if (event?.stage === 'plan_step' && event.step_id !== undefined) return event.step_id;
    }
    return null;
  }, [planExecuting, progressEvents]);

  // U9：逐步终态。执行中 plan 对象尚未回传（HTTP 响应在全部步骤结束后才到），
  // 靠 plan_step_done 事件让任务卡实时推进；资产行只有元数据，正文由 HTTP 响应补齐。
  const planStepRuntime = useMemo(() => {
    const byStep = {};
    for (const event of progressEvents) {
      if (event?.stage !== 'plan_step_done' || event.step_id === undefined) continue;
      byStep[String(event.step_id)] = {
        status: event.step_status || 'done',
        terminalState: event.terminal_state || '',
        iterations: event.iterations,
        errorCode: event.error_code || '',
        assets: Array.isArray(event.assets) ? event.assets : [],
      };
    }
    return byStep;
  }, [progressEvents]);

  // Writer 反问内联卡：待回答时可交互，回答/跳过后转为只读摘要留在对话历史中。
  const clarification = useMemo(() => {
    if (!preWriteQuestions.length) return null;
    if (!showPreWriteDialog && !clarificationResolved) return null;
    return {
      questions: preWriteQuestions,
      reason: clarificationMeta?.reason || '',
      resolved: showPreWriteDialog ? null : clarificationResolved,
    };
  }, [showPreWriteDialog, clarificationResolved, preWriteQuestions, clarificationMeta]);

  const openClarification = useCallback((payload, promptOverride = null) => {
    const questions = normalizeClarificationQuestionsFromResponse(payload);
    if (!questions.length) return false;

    const turnId = String(payload?.turn_id || payload?.runtime?.turn_id || '');
    const prompt = promptOverride || activeChatPromptRef.current || {};
    const chapter = String(payload?.chapter || payload?.chapter_target?.chapter || prompt.chapter || '');
    const fallbackKey = `${chapter}:${questions.map((question) => question.text).join('\u001f')}`;
    const requestKey = turnId || fallbackKey;

    // WS 是即时主路径，HTTP 是最终兜底。两者可能携带同一 turn；已展示或已回答的
    // turn 均视为幂等成功，避免重复开卡或旧 HTTP 响应覆盖下一轮状态。
    if (
      activeClarificationKeyRef.current === requestKey ||
      resolvedClarificationKeysRef.current.has(requestKey)
    ) {
      return true;
    }

    activeClarificationKeyRef.current = requestKey;
    setPreWriteQuestions(questions);
    setClarificationMeta(payload?.clarification || null);
    setClarificationResolved(null);
    setPendingChatPrompt({ text: String(prompt.text || ''), chapter, turnId });
    setShowPreWriteDialog(true);
    setStatus('waiting_user_input');
    setIsGenerating(false);
    return true;
  }, []);

  const resolveActiveClarification = useCallback(() => {
    const requestKey = activeClarificationKeyRef.current;
    if (!requestKey) return;
    const resolved = resolvedClarificationKeysRef.current;
    resolved.add(requestKey);
    while (resolved.size > 100) {
      resolved.delete(resolved.values().next().value);
    }
    activeClarificationKeyRef.current = '';
  }, []);

  const [agentTurnMeta, setAgentTurnMeta] = useState(null);
  const [writingMemoryTurn, setWritingMemoryTurn] = useState(null);
  const [canonTurnState, setCanonTurnState] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState('');

  const addMessage = useCallback(
    (type, content) => {
      const key = projectChatKey;
      if (!key) {
        return;
      }
      setMessagesByChapter((prev) => {
        const next = { ...(prev || {}) };
        const existing = Array.isArray(next[key]) ? next[key] : [];
        next[key] = [...existing, { type, content, time: new Date() }].slice(-200);
        return next;
      });
      if (type === 'user' && activeConversationId) {
        setConversations((prev) =>
          prev.map((item) =>
            item.id === activeConversationId && item.title === '新对话'
              ? { ...item, title: String(content || '').replace(/\s+/g, ' ').trim().slice(0, 32) || item.title }
              : item,
          ),
        );
      }
      // chat 入口负责权威持久事件；这里只更新展示，避免前后端双写。
    },
    [projectChatKey, activeConversationId],
  );

  // 本地长存 + Git-Native 持久化：开项目时优先从后端加载对话历史（扛刷新/重启/清缓存/换机），
  // 失败或空则回退 localStorage 缓存。progressEvents（过程轨迹）仍走本地缓存。
  useEffect(() => {
    if (!projectId) return;
    const key = projectChatKey;
    let cancelled = false;

    const fromLocal = () => {
      try {
        const raw = window.localStorage.getItem(`wenshape_chat_v2_${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const msgs = Array.isArray(parsed?.messages)
            ? parsed.messages.map((m) => ({ ...m, time: m?.time ? new Date(m.time) : new Date() }))
            : [];
          // 过滤掉旧的连接状态事件（已废弃的「连接中断/重连」提示，避免 localStorage 残留再显示）。
          return { msgs };
        }
      } catch {
        /* 忽略损坏的本地缓存 */
      }
        return { msgs: [] };
    };

    const hydrate = async () => {
      let serverMsgs = null;
      try {
        const conversationsResp = await sessionAPI.listConversations(key);
        const conversationList = Array.isArray(conversationsResp?.data?.conversations)
          ? conversationsResp.data.conversations
          : [];
        const activeId = conversationList.find((item) => item.active)?.id || '';
        if (!cancelled) {
          setConversations(conversationList);
          setActiveConversationId(activeId);
        }
        const resp = await sessionAPI.getHistory(key, 0, activeId);
        const list = Array.isArray(resp?.data?.messages) ? resp.data.messages : [];
        serverMsgs = list.map((m) => ({
          type: m?.type === 'activity' ? 'system' : m?.type === 'error' ? 'error' : m?.role || 'system',
          content: String(m?.content ?? ''),
          time: m?.ts ? new Date(m.ts) : new Date(),
        }));
      } catch {
        /* 后端不可用 → 回退本地缓存 */
      }
      if (cancelled) return;
      const local = fromLocal();
      setMessagesByChapter((prev) => ({ ...(prev || {}), [key]: serverMsgs !== null ? serverMsgs : local.msgs }));
      setProgressEventsByChapter((prev) => ({ ...(prev || {}), [key]: [] }));
      chatHydratedRef.current = key;
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectChatKey]);

  useEffect(() => {
    if (!projectId) return;
    if (chatHydratedRef.current !== projectChatKey) return; // 等水合完成再写，避免覆盖
    try {
      window.localStorage.setItem(`wenshape_chat_v2_${projectChatKey}`, JSON.stringify({ messages }));
    } catch {
      /* 忽略配额/序列化异常 */
    }
  }, [messages, projectId, projectChatKey]);


  useEffect(() => {
    if (!isGenerating && !canUseWriter && agentMode === 'create') {
      setAgentMode('edit');
    }
    if (!isGenerating && canUseWriter && agentMode === 'edit') {
      setAgentMode('create');
    }
  }, [canUseWriter, agentMode, isGenerating]);

  useEffect(() => {
    if (agentMode !== 'edit') return;
    if (!attachedSelection?.text?.trim()) {
      if (editScope === 'selection') setEditScope('document');
      return;
    }
    if (editScope === 'document') setEditScope('selection');
  }, [agentMode, attachedSelection, editScope]);

  // Card State
  const [activeCard, setActiveCard] = useState(null);
  const [cardForm, setCardForm] = useState({
    name: '',
    description: '',
    aliases: '',
    stars: 1,
    category: '',
  });

  // SWR for Chapter Content
  const {
    data: loadedContent,
    error: chapterLoadError,
    isLoading: chapterLoading,
  } = useSWR(
    chapterInfo.chapter ? ['chapter', projectId, chapterInfo.chapter] : null,
    fetchChapterContent,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Cache for 1 minute before checking again
      keepPreviousData: false, // Don't show previous chapter data while loading (we handle this with manualContent update)
    },
  );

  const { data: volumes = [] } = useSWR(
    // Keep SWR key consistent across the app so volume creation immediately updates all views.
    projectId ? [projectId, 'volumes'] : null,
    () => volumesAPI.list(projectId).then((res) => res.data),
    { revalidateOnFocus: false },
  );

  const memoryPackChapter =
    writingMemoryTurn?.chapter || diffReview?.chapterKey || streamingChapterKeyRef.current || chapterInfo.chapter;
  const {
    data: memoryPackStatus,
    isLoading: memoryPackLoading,
    mutate: mutateMemoryPack,
  } = useSWR(
    projectId && memoryPackChapter ? ['memory-pack', projectId, String(memoryPackChapter)] : null,
    () => memoryPackAPI.getStatus(projectId, String(memoryPackChapter)).then((response) => response.data),
    { revalidateOnFocus: false, refreshInterval: agentBusy ? 1000 : 5000 },
  );

  const applyAcceptedTurnEffect = useCallback(
    async (targetProjectId, chapter) => {
      const key = `${targetProjectId}:${chapter}`;
      const turnEffect = canonSyncPendingRef.current.get(key);
      if (!turnEffect) return { success: true, skipped: true };
      const existing = canonSyncInFlightRef.current.get(key);
      if (existing) return existing;

      setCanonTurnState({ chapter, effect: turnEffect, status: 'syncing', result: null });

      const request = sessionAPI
        .applyTurnEffect(targetProjectId, {
          chapter,
          language: requestLanguage,
          turn_effect: turnEffect,
        })
        .then(async (response) => {
          const result = response?.data || {};
          if (!result.success) {
            canonSyncPendingRef.current.delete(key);
            const snapshot = readDraftRecovery(window.localStorage, targetProjectId, chapter);
            if (snapshot) {
              writeDraftRecovery(window.localStorage, { ...snapshot, needsCanonSync: false, turnEffect: null });
            }
            setCanonTurnState({ chapter, effect: turnEffect, status: 'failed', result });
            pushNotice(
              t('writingSession.factsAutoSyncFailed') +
                (result.reason ? ` ${String(result.reason)}` : ''),
            );
            return result;
          }

          canonSyncPendingRef.current.delete(key);
          const snapshot = readDraftRecovery(window.localStorage, targetProjectId, chapter);
          if (snapshot) {
            const last = autosaveLastPayloadRef.current || {};
            if (
              String(last.chapter || '') === String(chapter) &&
              String(last.content ?? '') === String(snapshot.content ?? '')
            ) {
              clearDraftRecovery(window.localStorage, targetProjectId, chapter);
            } else {
              writeDraftRecovery(window.localStorage, {
                ...snapshot,
                needsCanonSync: false,
                turnEffect: null,
              });
            }
          }
          await mutateSWR([targetProjectId, 'facts-tree']);
          setCanonTurnState({
            chapter,
            effect: turnEffect,
            status: result.applied ? 'applied' : 'skipped',
            result,
          });
          pushNotice(t(result.applied ? 'writingSession.factsAutoSynced' : 'writingSession.factsAutoSkipped'));
          return result;
        })
        .catch((error) => {
          canonSyncPendingRef.current.delete(key);
          const snapshot = readDraftRecovery(window.localStorage, targetProjectId, chapter);
          if (snapshot) {
            writeDraftRecovery(window.localStorage, { ...snapshot, needsCanonSync: false, turnEffect: null });
          }
          setCanonTurnState({ chapter, effect: turnEffect, status: 'failed', result: null });
          pushNotice(t('writingSession.factsAutoSyncFailed') + extractErrorDetail(error));
          return { success: false, error };
        })
        .finally(() => {
          canonSyncInFlightRef.current.delete(key);
        });

      canonSyncInFlightRef.current.set(key, request);
      return request;
    },
    [pushNotice, requestLanguage, t],
  );

  const saveAutosaveTask = useCallback(
    async (task) => {
      const payload = { content: task.content };
      if (task.title) payload.title = task.title;
      const response = task.createBackup
        ? await draftsAPI.updateContent(task.projectId, task.chapter, payload)
        : await draftsAPI.autosaveContent(task.projectId, task.chapter, payload);
      if (!response?.data?.success) throw new Error('autosave_failed');

      autosaveLastPayloadRef.current = {
        chapter: task.chapter,
        content: task.content,
        title: task.title || null,
      };
      backupRequiredRef.current.delete(`${task.projectId}:${task.chapter}`);
      await mutateSWR(['chapter', task.projectId, task.chapter], task.content, false);

      const currentSnapshot = readDraftRecovery(window.localStorage, task.projectId, task.chapter);
      const canonKey = `${task.projectId}:${task.chapter}`;
      const pendingTurnEffect = canonSyncPendingRef.current.get(canonKey);
      if (pendingTurnEffect) {
        writeDraftRecovery(window.localStorage, {
          ...(currentSnapshot || {}),
          projectId: task.projectId,
          chapter: task.chapter,
          content: currentSnapshot?.content ?? task.content,
          title: currentSnapshot?.title ?? task.title,
          savedContent: task.content,
          needsCanonSync: true,
          turnEffect: pendingTurnEffect,
        });
        void applyAcceptedTurnEffect(task.projectId, task.chapter);
      } else if (currentSnapshot && String(currentSnapshot.content ?? '') === String(task.content ?? '')) {
        clearDraftRecovery(window.localStorage, task.projectId, task.chapter);
      } else if (currentSnapshot) {
        writeDraftRecovery(window.localStorage, {
          ...currentSnapshot,
          savedContent: task.content,
          needsCanonSync: false,
          turnEffect: null,
        });
      }

      const isCurrent =
        String(task.projectId) === String(projectId) &&
        activeChapterKeyRef.current === String(task.chapter) &&
        String(manualContentRef.current ?? '') === String(task.content ?? '');
      if (isCurrent) dispatch({ type: 'SET_AUTOSAVED' });
      if (
        latestAutosavePayloadRef.current &&
        String(latestAutosavePayloadRef.current.projectId) === String(task.projectId) &&
        String(latestAutosavePayloadRef.current.chapter) === String(task.chapter) &&
        String(latestAutosavePayloadRef.current.content ?? '') === String(task.content ?? '')
      ) {
        latestAutosavePayloadRef.current = null;
      }
      return response.data;
    },
    [applyAcceptedTurnEffect, dispatch, projectId],
  );

  autosaveWorkerRef.current = saveAutosaveTask;
  if (!autosaveQueueRef.current) {
    autosaveQueueRef.current = createLatestTaskQueue((task) => autosaveWorkerRef.current(task));
  }

  const flushAutosaveQueue = useCallback(async () => {
    try {
      await autosaveQueueRef.current.flush();
      return true;
    } catch (error) {
      dispatch({ type: 'SET_UNSAVED' });
      pushNotice(t('writingSession.autoSaveFailed') + extractErrorDetail(error));
      if (autosaveRetryTimerRef.current) window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = window.setTimeout(() => {
        autosaveRetryTimerRef.current = null;
        void flushAutosaveQueue();
      }, 2500);
      return false;
    }
  }, [dispatch, pushNotice, t]);

  const queueAutosave = useCallback(
    (payload, { immediate = false, createBackup = false, turnEffect = null } = {}) => {
      const targetProjectId = String(payload.projectId || projectId || '');
      const targetChapter = String(payload.chapter || '');
      if (!targetProjectId || !targetChapter) return Promise.resolve(false);
      const key = `${targetProjectId}:${targetChapter}`;
      if (createBackup) backupRequiredRef.current.add(key);
      if (turnEffect && typeof turnEffect === 'object') canonSyncPendingRef.current.set(key, turnEffect);

      const task = {
        projectId: targetProjectId,
        chapter: targetChapter,
        content: String(payload.content ?? ''),
        title: payload.title ? String(payload.title) : null,
        createBackup: backupRequiredRef.current.has(key),
      };
      latestAutosavePayloadRef.current = task;
      const last = autosaveLastPayloadRef.current || {};
      writeDraftRecovery(window.localStorage, {
        ...task,
        savedContent: String(last.chapter || '') === targetChapter ? String(last.content ?? '') : '',
        needsCanonSync: canonSyncPendingRef.current.has(key),
        turnEffect: canonSyncPendingRef.current.get(key) || null,
      });
      autosaveQueueRef.current.replace(task);

      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (immediate) return flushAutosaveQueue();
      autosaveTimerRef.current = window.setTimeout(() => {
        autosaveTimerRef.current = null;
        void flushAutosaveQueue();
      }, 1200);
      return Promise.resolve(true);
    },
    [flushAutosaveQueue, projectId],
  );

  // Sync SWR data to manualContent
  useEffect(() => {
    const chapterKey = activeChapterKey;
    if (
      !shouldApplyLoadedChapter({
        selectedChapter: chapterKey,
        loadState: chapterLoadStateRef.current,
        loadedContent,
        hasUnsavedChanges: state.unsavedChanges,
      })
    ) return;
    if (isStreamingForActiveChapter || isDiffReviewForActiveChapter) {
      return;
    }

    if (chapterKey === NO_CHAPTER_KEY) return;

    const lastGeneratedForChapter = Boolean(lastGeneratedByChapterRef.current?.[chapterKey]);
    if (lastGeneratedForChapter && manualContent && !(loadedContent || '').trim()) {
      return;
    }

    const recoverySnapshot = readDraftRecovery(window.localStorage, projectId, chapterKey);
    const recovery = resolveDraftRecovery(recoverySnapshot, loadedContent);
    const resolvedContent = recovery.action === 'restore' ? recovery.content : loadedContent;
    if (recovery.needsCanonSync && recovery.turnEffect) {
      canonSyncPendingRef.current.set(`${projectId}:${chapterKey}`, recovery.turnEffect);
    }
    if (recovery.action === 'clear') {
      clearDraftRecovery(window.localStorage, projectId, chapterKey);
    } else if (recovery.action === 'sync_canon') {
      void applyAcceptedTurnEffect(projectId, chapterKey);
    } else if (recovery.action === 'restore') {
      if (recovery.title) {
        setChapterInfo((prev) => ({ ...prev, chapter_title: recovery.title }));
      }
      pushNotice(t('writingSession.localDraftRecovered'));
    }

    setManualContentByChapter((prev) => ({ ...(prev || {}), [chapterKey]: resolvedContent }));
    setManualContent(resolvedContent);
    chapterLoadStateRef.current = { chapter: chapterKey, ready: true };
    setViewRestoreKey(chapterKey); // 正文就绪 → 下一帧恢复该章的滚动与光标位置
    autosaveLastPayloadRef.current = {
      chapter: chapterKey,
      content: loadedContent,
      title: String(chapterInfoRef.current?.chapter_title || '').trim() || null,
    };
    dispatch({ type: 'SET_WORD_COUNT', payload: countWords(resolvedContent, writingLanguage) });
    dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
    dispatch({ type: recovery.action === 'restore' ? 'SET_UNSAVED' : 'SET_SAVED' });
    lastGeneratedByChapterRef.current[chapterKey] = false;
    // Only center cursor if we just switched chapters (optional optimization)
    // dispatch({ type: 'SET_CURSOR_POSITION', payload: { line: 1, column: 1 } });
  }, [
    NO_CHAPTER_KEY,
    activeChapterKey,
    dispatch,
    isDiffReviewForActiveChapter,
    isStreamingForActiveChapter,
    loadedContent,
    manualContent,
    projectId,
    pushNotice,
    state.unsavedChanges,
    applyAcceptedTurnEffect,
    t,
    writingLanguage,
  ]);

  const loadChapters = useCallback(async () => {
    try {
      const resp = await draftsAPI.listChapters(projectId);
      const list = resp.data || [];
      setChapters(list);
    } catch (e) {
      logger.error('Failed to load chapters:', e);
    }
  }, [projectId]);

  useEffect(() => {
    loadChapters();
  }, [loadChapters]);

  // 重启后恢复该项目最后打开的章节；记录失效时回退到首个有效章节。
  useEffect(() => {
    if (!projectId || state.activeDocument || chapters.length === 0) return;
    let storedChapter = '';
    try {
      storedChapter = window.localStorage.getItem(lastChapterStorageKey(projectId)) || '';
    } catch {
      storedChapter = '';
    }
    const chapter = resolveRestoredChapter(chapters, storedChapter);
    if (chapter) {
      dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: chapter } });
    }
  }, [chapters, dispatch, projectId, state.activeDocument]);

  useEffect(() => {
    let active = true;
    const loadTitle = async () => {
      if (!projectId || !chapterInfo.chapter) return;
      if (chapterInfo.chapter_title && chapterInfo.chapter_title.trim()) return;
      try {
        const summaryResp = await draftsAPI.getSummary(projectId, chapterInfo.chapter);
        const summary = summaryResp.data || {};
        const title = summary.title || summary.chapter_title || '';
        if (active && title) {
          setChapterInfo((prev) => ({ ...prev, chapter_title: title }));
        }
      } catch (e) {
        // ignore missing summary
      }
    };
    loadTitle();
    return () => {
      active = false;
    };
  }, [projectId, chapterInfo.chapter, chapterInfo.chapter_title]);

  // 监听 Context 中的 Dialog 状态
  useEffect(() => {
    if (state.createChapterDialogOpen !== showChapterDialog) {
      setShowChapterDialog(state.createChapterDialogOpen);
    }
  }, [showChapterDialog, state.createChapterDialogOpen]);

  const clearDiffReview = useCallback(() => {
    setDiffReview(null);
    setDiffDecisions({});
  }, []);

  const stopStreaming = useCallback(() => {
    if (streamingRef.current?.timer) {
      streamingRef.current.timer();
    }
    streamingRef.current = null;
    setStreamingState({
      active: false,
      progress: 0,
      current: 0,
      total: 0,
    });
  }, []);

  // 将一次完整生成（写全章 / 续写）落为差异提议：原文 vs 生成文 → DiffReviewView 审阅。
  // 写作和编辑统一落为差异提议：真相在文件，Agent 提议可采纳或拒绝。
  const finalizeDraftAsDiff = useCallback(
    (chapterKey, finalText, turnEffect = null, chapterTarget = null, changeSet = []) => {
      const key = String(chapterKey || '');
      if (!key) return;
      const revised = String(finalText || '');
      const isActive = activeChapterKeyRef.current === key;

      // 退化：空结果或与原文一致 → 直接落地，不打扰（稳健兜底）。
      const normalizedChangeSet = Array.isArray(changeSet) ? changeSet.filter((item) => item && typeof item === 'object') : [];
      // 基线优先取 change_set 里该资产的权威 original（后端给的原文），其次才是本地
      // 流式前快照；两者都没有即为「未知」，此时一律不写缓存——未知不是空。
      const baseline = resolveDiffBaseline({
        changeSet: normalizedChangeSet,
        assetId: key,
        store: streamOriginalByChapterRef.current,
        key,
      });
      const baselineKnown = isKnownBaseline(baseline);
      const original = baselineKnown ? baseline : '';
      const displayChange =
        normalizedChangeSet.find(
          (item) => item.asset_type === 'chapter' && String(item.asset_id || '') === key,
        ) || normalizedChangeSet[0];
      const displayAssetType = String(displayChange?.asset_type || 'chapter');
      const displayAssetId = String(displayChange?.asset_id || key);
      const displayOriginal = displayChange ? String(displayChange.original || '') : original;
      const displayRevised = displayChange ? String(displayChange.revised || '') : revised;
      if ((!revised.trim() || revised === original) && !normalizedChangeSet.some((item) => item.asset_type === 'outline')) {
        // 生成结果为空时不得覆盖缓存：基线未知说明我们根本不知道这一章原本有什么。
        if (revised.trim() || baselineKnown) {
          setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: revised }));
          if (isActive) {
            setManualContent(revised);
            dispatch({ type: 'SET_WORD_COUNT', payload: countWords(revised, writingLanguage) });
            dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
          }
        }
        delete streamOriginalByChapterRef.current[key];
        return;
      }

      const diff = buildLineDiff(displayOriginal, displayRevised, { contextLines: 2 });
      const hunksWithReason = (diff.hunks || []).map((hunk) => ({
        ...hunk,
        reason: t('writingSession.draftDiffReason'),
      }));
      const initialDecisions = hunksWithReason.reduce((acc, hunk) => {
        acc[hunk.id] = 'accepted';
        return acc;
      }, {});
      setDiffDecisions(initialDecisions);
      setDiffReview((prev) => ({
        ...diff,
        hunks: hunksWithReason,
        originalContent: displayOriginal,
        revisedContent: displayRevised,
        chapterKey: key,
        assetType: displayAssetType,
        assetId: displayAssetId,
        turnEffect,
        chapterTarget,
        // 计划执行中按资产累积，避免先完成的章节从待批准列表消失；单轮对话仍整体替换。
        changeSet: planExecutingRef.current
          ? mergeChangeSets(prev?.changeSet, normalizedChangeSet)
          : normalizedChangeSet,
      }));
      if (displayAssetType === 'outline') {
        dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'outline', id: 'outline' } });
      }
      // 正文暂留原文，待用户采纳后才落地修订（接受全部 / 逐块 / 放弃）。
      // 基线未知时不写缓存也不动编辑器：写入伪造的空串会让这一章在切换后显示为空白，
      // 并被 autosave 当作作者的清空操作保存回磁盘。
      if (baselineKnown) {
        setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: original }));
        if (isActive) setManualContent(original);
      }
      delete streamOriginalByChapterRef.current[key];
    },
    [dispatch, t, writingLanguage],
  );

  // 记下当前章节在编辑器里的位置（滚动 + 光标），供标签切回时还原。
  // 只写 ref，不进 React state：滚动事件很密集，不能触发重渲染。
  const captureEditorViewState = useCallback(() => {
    const element = editorRef.current;
    const key = activeChapterKeyRef.current;
    if (!element || !key || key === NO_CHAPTER_KEY) return;
    if (restoredKeyRef.current !== key) return; // 尚未为该章摆位（刚挂载）→ 此刻的 0 不是用户位置
    viewStateByChapterRef.current[key] = {
      scrollTop: element.scrollTop,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    };
  }, [NO_CHAPTER_KEY]);

  // 编辑器 ref 回调：从大纲/卡片切回时 textarea 会重新挂载，挂载即申请一次位置还原。
  // 章节之间切换不会重建这个 DOM 节点，那条路径由 handleChapterSelect / SWR 就绪点触发。
  const attachEditor = useCallback(
    (element) => {
      editorRef.current = element;
      if (!element) {
        restoredKeyRef.current = null;
        return;
      }
      const key = activeChapterKeyRef.current;
      if (key && key !== NO_CHAPTER_KEY) setViewRestoreKey(key);
    },
    [NO_CHAPTER_KEY],
  );

  const handleChapterSelect = useCallback(
    async (chapter, presetTitle = '') => {
      const nextChapterKey = chapter ? String(chapter) : NO_CHAPTER_KEY;
      const currentInfo = chapterInfoRef.current || {};
      const currentKey = currentInfo.chapter ? String(currentInfo.chapter) : NO_CHAPTER_KEY;
      const currentContent = String(manualContentRef.current || '');
      const preserveAgent = agentBusy;
      captureEditorViewState();

      if (
        currentKey === nextChapterKey &&
        chapterLoadStateRef.current.chapter === nextChapterKey &&
        chapterLoadStateRef.current.ready
      ) {
        if (presetTitle && !currentInfo.chapter_title) {
          setChapterInfo((prev) => ({ ...prev, chapter_title: presetTitle }));
        }
        return;
      }

      // 缓存当前章节内容，避免切章丢失
      if (currentKey !== NO_CHAPTER_KEY) {
        setManualContentByChapter((prev) => ({ ...(prev || {}), [currentKey]: currentContent }));

        // 切换前尽力落盘当前章节，避免全局脏状态泄漏到下一章。
        if (currentKey !== nextChapterKey && unsavedChangesRef.current) {
          if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
          }
          const title = String(currentInfo.chapter_title || '').trim() || null;
          // 只有正文真的变了才生成带时间戳的版本备份。标签栏让切章变得高频，
          // 无条件备份会让 drafts/*.backup/ 迅速堆满内容完全相同的快照。
          const lastSaved = autosaveLastPayloadRef.current || {};
          const contentChanged =
            String(lastSaved.chapter || '') !== currentKey || String(lastSaved.content ?? '') !== currentContent;
          const saved = await queueAutosave(
            { projectId, chapter: currentKey, content: currentContent, title },
            { immediate: true, createBackup: contentChanged },
          );
          if (!saved) {
            dispatch({
              type: 'SET_ACTIVE_DOCUMENT',
              payload: { type: 'chapter', id: currentKey, title: currentInfo.chapter_title || '' },
            });
            return;
          }
        }
      }

      // 非写作/编辑进行中：切章时清理流式与差异态
      if (!preserveAgent) {
        stopStreaming();
        clearDiffReview();
        setStatus('editing');
      }

      chapterLoadStateRef.current = { chapter: nextChapterKey, ready: false };
      setChapterInfo({ chapter, chapter_title: presetTitle || '', content: '' }); // content will be filled by SWR
      setSelectionInfo({ start: 0, end: 0, text: '' });
      setAttachedSelection(null);
      setEditScope('document');

      // 优先使用本地缓存，减少切章时的"空白闪烁"
      if (nextChapterKey && nextChapterKey !== NO_CHAPTER_KEY) {
        try {
          window.localStorage.setItem(lastChapterStorageKey(projectId), nextChapterKey);
        } catch {
          // 禁用本地存储时不影响章节加载。
        }
        const cached = manualContentByChapterRef.current?.[nextChapterKey];
        if (typeof cached === 'string') {
          chapterLoadStateRef.current = { chapter: nextChapterKey, ready: true };
          autosaveLastPayloadRef.current = {
            chapter: nextChapterKey,
            content: cached,
            title: presetTitle || null,
          };
          setManualContent(cached);
          setViewRestoreKey(nextChapterKey);
          dispatch({ type: 'SET_WORD_COUNT', payload: countWords(cached, writingLanguage) });
          dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        } else {
          setManualContent('');
          setViewRestoreKey(nextChapterKey);
          dispatch({ type: 'SET_WORD_COUNT', payload: 0 });
          dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        }
      }
      try {
        const summaryResp = await draftsAPI.getSummary(projectId, chapter);
        const summary = summaryResp.data || {};
        const normalizedChapter = summary.chapter || chapter;
        const title = summary.title || summary.chapter_title || '';
        setChapterInfo((prev) => ({
          ...prev,
          chapter: normalizedChapter,
          chapter_title: title || prev.chapter_title || '',
        }));
        if (normalizedChapter !== chapter) {
          try {
            window.localStorage.setItem(lastChapterStorageKey(projectId), String(normalizedChapter));
          } catch {
            // 禁用本地存储时不影响章节加载。
          }
          dispatch({
            type: 'SET_ACTIVE_DOCUMENT',
            payload: { type: 'chapter', id: normalizedChapter, title: title || presetTitle || '' },
          });
        }
      } catch (e) {
        // Summary may not exist yet.
      }
    },
    [
      NO_CHAPTER_KEY,
      agentBusy,
      captureEditorViewState,
      clearDiffReview,
      dispatch,
      projectId,
      queueAutosave,
      stopStreaming,
      writingLanguage,
    ],
  );

  // 正文写入 DOM 后立即还原视图位置：在 layout 阶段完成，用户看不到「先跳顶部再跳回」。
  // 没有记忆的章节显式归零 —— 编辑器 textarea 在切章时是复用的同一个 DOM 节点，
  // 不主动重置就会停留在上一章的滚动位置。
  useLayoutEffect(() => {
    if (!viewRestoreKey) return;
    const element = editorRef.current;
    if (!element) return;
    if (activeChapterKeyRef.current !== viewRestoreKey) return;

    const saved = viewStateByChapterRef.current[viewRestoreKey];
    const length = element.value.length;
    const start = Math.min(Math.max(0, saved?.selectionStart ?? 0), length);
    const end = Math.min(Math.max(start, saved?.selectionEnd ?? start), length);
    // 不 focus()：切标签不该抢走输入焦点，只把位置摆好。
    element.setSelectionRange(start, end);
    element.scrollTop = Math.max(0, saved?.scrollTop ?? 0);
    restoredKeyRef.current = viewRestoreKey;

    const lines = element.value.slice(0, start).split('\n');
    dispatch({
      type: 'SET_CURSOR_POSITION',
      payload: { line: lines.length, column: lines[lines.length - 1].length + 1 },
    });
    setViewRestoreKey(null);
  }, [dispatch, manualContent, viewRestoreKey]);

  // 标签关闭（手动关闭或超出上限被 LRU 淘汰）后回收该章的正文副本与视图位置。
  // 正在流式写入或有待审 diff 的章节不回收，避免打断进行中的写作。
  // 必须排在下面的 activeDocument 副作用之后：关掉当前标签会顺带触发 handleChapterSelect
  // 把「刚关掉的这一章」重新写回缓存，回收要后手才生效。
  const previousTabKeysRef = useRef([]);

  const handleChapterCreate = async (chapterData) => {
    // Handle object from ChapterCreateDialog or direct arguments
    const chapterNum = typeof chapterData === 'object' ? chapterData.id : chapterData;
    const chapterTitle = typeof chapterData === 'object' ? chapterData.title : arguments[1];

    // Persist the new chapter immediately
    setIsSaving(true);
    let normalizedChapter = chapterNum;
    try {
      const resp = await draftsAPI.updateContent(projectId, chapterNum, {
        content: '',
        title: chapterTitle,
      });
      normalizedChapter = resp.data?.chapter || chapterNum;
      addMessage('system', t('writingSession.chapterCreated').replace('{id}', normalizedChapter), normalizedChapter);
      dispatch({
        type: 'SET_ACTIVE_DOCUMENT',
        payload: { type: 'chapter', id: normalizedChapter, title: chapterTitle || '' },
      });
    } catch (e) {
      addMessage('error', t('writingSession.chapterCreateFailed') + extractErrorDetail(e));
    } finally {
      setIsSaving(false);
    }

    setChapterInfo({ chapter: normalizedChapter, chapter_title: chapterTitle, content: '' });
    setManualContent('');
    stopStreaming();
    clearDiffReview();
    setShowChapterDialog(false);
    setStatus('idle');
    await loadChapters();
  };

  const appendProgressEvent = useCallback(
    (partial) => {
      const key = projectChatKey;
      if (!key) {
        return;
      }
      setProgressEventsByChapter((prev) => {
        const next = { ...(prev || {}) };
        const existing = Array.isArray(next[key]) ? next[key] : [];
        next[key] = appendAgentProgressEvent(existing, partial);
        return next;
      });
    },
    [projectChatKey],
  );

  // Auto Save（类似 VSCode：检测到变更后自动保存）
  useEffect(() => {
    if (
      !canAutosaveLoadedChapter({
        projectId,
        chapter: chapterInfo.chapter,
        loadState: chapterLoadStateRef.current,
        hasUnsavedChanges: state.unsavedChanges,
        blocked: isStreamingForActiveChapter || isDiffReviewForActiveChapter,
      })
    ) return;

    const nextContent = String(manualContent || '');
    const nextTitle = String(chapterInfo.chapter_title || '').trim() || null;

    const last = autosaveLastPayloadRef.current || {};
    const sameChapter = String(last.chapter || '') === String(chapterInfo.chapter);
    const sameContent = sameChapter && String(last.content || '') === nextContent;
    const sameTitle = sameChapter && (last.title || null) === nextTitle;
    if (sameContent && sameTitle) return;

    // 数据丢失红线：绝不以空内容覆盖同一章已知非空的正文。
    // 作者主动清空是合法操作，靠「本章最近一次用户输入」放行；
    // 而缓存/基线缺陷导致的空白与用户输入对不上，静默保存会直接抹掉磁盘正文。
    if (
      sameChapter &&
      shouldBlockEmptyAutosave({
        next: nextContent,
        lastKnown: last.content,
        lastUserInput: lastUserInputRef.current,
        chapter: chapterInfo.chapter,
      })
    ) {
      pushNotice(t('writingSession.emptyOverwriteBlocked'));
      return;
    }

    void queueAutosave({
      projectId,
      chapter: chapterInfo.chapter,
      content: nextContent,
      title: nextTitle,
    });

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    chapterInfo.chapter,
    chapterInfo.chapter_title,
    isDiffReviewForActiveChapter,
    isStreamingForActiveChapter,
    manualContent,
    projectId,
    pushNotice,
    queueAutosave,
    state.unsavedChanges,
    t,
  ]);

  useEffect(() => {
    const currentPayload = () => {
      if (!projectId || !chapterInfoRef.current?.chapter || !unsavedChangesRef.current) return null;
      const latest = latestAutosavePayloadRef.current;
      return (
        (latest && String(latest.projectId) === String(projectId) ? latest : null) || {
          projectId,
          chapter: String(chapterInfoRef.current.chapter),
          content: String(manualContentRef.current ?? ''),
          title: String(chapterInfoRef.current.chapter_title || '').trim() || null,
          createBackup: false,
        }
      );
    };

    const flushOnPageHide = () => {
      const payload = currentPayload();
      if (!payload) return;
      const canonKey = `${payload.projectId}:${payload.chapter}`;
      writeDraftRecovery(window.localStorage, {
        ...payload,
        savedContent: String(autosaveLastPayloadRef.current?.content ?? ''),
        needsCanonSync: canonSyncPendingRef.current.has(canonKey),
        turnEffect: canonSyncPendingRef.current.get(canonKey) || null,
      });
      autosaveQueueRef.current.replace(payload);
      void autosaveQueueRef.current.flush().catch(() => {});

      if (canSendKeepaliveDraft(payload)) {
        const body = JSON.stringify({
          content: payload.content,
          ...(payload.title ? { title: payload.title } : {}),
        });
        void fetch(
          `/api/projects/${encodeURIComponent(payload.projectId)}/drafts/${encodeURIComponent(payload.chapter)}/autosave`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          },
        ).catch(() => {});
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushOnPageHide();
    };
    const onBeforeUnload = (event) => {
      if (!currentPayload()) return;
      flushOnPageHide();
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('pagehide', flushOnPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushOnPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (autosaveRetryTimerRef.current) window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveQueueRef.current?.stop();
    };
  }, []);

  // 当资源管理器清空/删除当前章节时，主动回到空态，避免编辑区残留旧章节内容
  useEffect(() => {
    if (state.activeDocument) return;
    stopStreaming();
    clearDiffReview();
    setActiveCard(null);
    setChapterInfo({ chapter: null, chapter_title: null, content: null });
    setManualContent('');
    setStatus('idle');
  }, [clearDiffReview, state.activeDocument, stopStreaming]);

  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  // 监听 Context 中的文档选择（章节或卡片）
  useEffect(() => {
    if (!state.activeDocument) return;

    if (state.activeDocument.type === 'chapter' && state.activeDocument.id) {
      setActiveCard(null); // Clear card state
      const presetTitle =
        state.activeDocument.data?.title ||
        state.activeDocument.data?.chapter_title ||
        state.activeDocument.title ||
        state.activeDocument.chapter_title ||
        '';
      handleChapterSelect(state.activeDocument.id, presetTitle);
    } else if (['character', 'world'].includes(state.activeDocument.type)) {
      // Switch to Card Mode
      stopStreaming();
      clearDiffReview();
      setChapterInfo({ chapter: null, chapter_title: null, content: null });

      // Initial setup with basic info
      const cardData = state.activeDocument.data || { name: state.activeDocument.id };
      const originalName = state.activeDocument.id || cardData.name || '';
      const isNew = Boolean(state.activeDocument.isNew || cardData.isNew || !originalName);
      setActiveCard({
        ...cardData,
        type: state.activeDocument.type,
        isNew,
        originalName,
      });
      setCardForm({
        name: cardData.name || '',
        description: '',
        aliases: formatListInput(cardData.aliases),
        stars: normalizeStars(cardData.stars),
        category: cardData.category || '',
      });
      setStatus('card_editing');

      // Fetch full details
      const fetchCardDetails = async () => {
        try {
          let resp;
          if (state.activeDocument.type === 'character') {
            resp = await cardsAPI.getCharacter(projectId, state.activeDocument.id);
          } else {
            resp = await cardsAPI.getWorld(projectId, state.activeDocument.id);
          }
          const fullData = resp?.data || {};
          setCardForm({
            name: fullData.name || cardData.name || '',
            description: fullData.description || '',
            aliases: formatListInput(fullData.aliases),
            stars: normalizeStars(fullData.stars),
            category: fullData.category || '',
          });
        } catch (e) {
          logger.error('Failed to fetch card details', e);
          addMessage('error', t('writingSession.loadCardFailed') + extractErrorDetail(e));
        }
      };

      if (state.activeDocument.id) {
        fetchCardDetails();
      }
    }
  }, [addMessage, clearDiffReview, handleChapterSelect, projectId, state.activeDocument, stopStreaming, t]);

  useEffect(() => {
    const liveKeys = new Set(state.openTabs.map((tab) => tab.key));
    const removed = previousTabKeysRef.current.filter((key) => !liveKeys.has(key));
    previousTabKeysRef.current = state.openTabs.map((tab) => tab.key);
    if (!removed.length) return;

    const releasable = removed
      .filter((key) => key.startsWith('chapter:'))
      .map((key) => key.slice('chapter:'.length))
      .filter((chapter) => chapter !== streamingChapterKeyRef.current && chapter !== diffReview?.chapterKey);
    if (!releasable.length) return;

    releasable.forEach((chapter) => {
      delete viewStateByChapterRef.current[chapter];
    });
    setManualContentByChapter((prev) => {
      const next = { ...(prev || {}) };
      releasable.forEach((chapter) => delete next[chapter]);
      return next;
    });
  }, [diffReview, state.openTabs]);

  // Handlers
  const handleCancel = async () => {
    if (isCancelling || !projectId) return;
    setIsCancelling(true);
    // 立即关闭写作前面板，防止取消后面板残留
    setShowPreWriteDialog(false);
    setPreWriteQuestions([]);
    setClarificationMeta(null);
    setClarificationResolved(null);
    setPendingChatPrompt(null);
    resolveActiveClarification();
    clearDiffReview();
    try {
      await sessionAPI.cancel(projectId);
    } catch (e) {
      // 即使请求失败也重置前端状态，避免界面卡死
    } finally {
      stopStreaming();
      setIsGenerating(false);
      setStatus('idle');
      setIsCancelling(false);
    }
  };

  const handleChatClarificationConfirm = (answers) => {
    const pending = pendingChatPrompt;
    if (!pending) return;
    setPendingChatPrompt(null);
    resolveActiveClarification();
    setShowPreWriteDialog(false);
    // 内联卡转只读摘要（保留在对话历史中，不消失）；问题清单留着算「已回答 n / 总数」。
    setClarificationResolved({
      kind: 'answered',
      answered: (answers || []).filter((item) => String(item?.answer || '').trim()).length,
    });
    setClarificationMeta(null);
    setStatus('editing');
    const labelledDetails = (answers || [])
      .map((item) => {
        const answer = String(item?.answer || '').trim();
        const question = String(item?.question || '').trim();
        return answer ? `${question ? `问题：${question}\n` : ''}作者回答：${answer}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    const unanswered = (answers || [])
      .filter((item) => !String(item?.answer || '').trim())
      .map((item) => String(item?.question || '').trim())
      .filter(Boolean);
    const unansweredNote = unanswered.length
      ? `\n\n作者暂不补充以下问题，请不要重复询问相同问题，基于现有信息继续：\n${unanswered.map((item) => `- ${item}`).join('\n')}`
      : '';
    const followUp = labelledDetails
      ? `${pending.text}\n\n补充信息：\n${labelledDetails}${unansweredNote}`
      : `${pending.text}${unansweredNote}`;
    // 问题—作者回答作为下一轮 Writer 输入；Writer 仍可基于新上下文自行判断是否还需反问。
    handleChatSubmit(followUp);
  };

  const handleChatClarificationSkip = () => {
    const pending = pendingChatPrompt;
    setPendingChatPrompt(null);
    resolveActiveClarification();
    setShowPreWriteDialog(false);
    setClarificationResolved({ kind: 'skipped', answered: 0 });
    setClarificationMeta(null);
    if (pending?.text) {
      // 跳过仍作为下一轮 Writer 文本输入，不绕过工具或建立第二条 workflow。
      addMessage('system', t('agentPanel.clarificationSkipped') || '已跳过反问，直接开始撰写。');
      const skippedQuestions = (preWriteQuestions || [])
        .map((item) => String(item?.text || '').trim())
        .filter(Boolean);
      const skippedNote = skippedQuestions.length
        ? `\n\n作者暂不补充以下问题，请不要重复询问相同问题，基于现有信息继续：\n${skippedQuestions.map((item) => `- ${item}`).join('\n')}`
        : '\n\n作者选择不补充反问，请基于现有信息继续完成本轮。';
      handleChatSubmit(`${pending.text}${skippedNote}`);
      return;
    }
    setIsGenerating(false);
    setStatus('idle');
  };

  useWritingSessionRealtime({
    projectId,
    noChapterKey: NO_CHAPTER_KEY,
    addMessage,
    appendProgressEvent,
    clearDiffReview,
    dispatch,
    pushNotice,
    serverStreamActiveRef,
    serverStreamUsedRef,
    setAgentTraces,
    setIsGenerating,
    setManualContent,
    setManualContentByChapter,
    setStatus,
    setStreamingState,
    setTraceEvents,
    stopStreaming,
    streamBufferByChapterRef,
    streamFlushRafByChapterRef,
    streamingChapterKeyRef,
    streamTextByChapterRef,
    t,
    traceWsRef,
    wsRef,
    wsStatusRef,
    activeChapterKeyRef,
    lastGeneratedByChapterRef,
    writingLanguage,
    streamOriginalByChapterRef,
    onStreamFinalize: finalizeDraftAsDiff,
    onInputRequired: openClarification,
  });

  const applyAcceptedChangeSet = useCallback(
    async (changes, turnEffect = null) => {
      const acceptedChanges = mergeChangeSets([], changes).filter(
        (item) => item && typeof item === 'object' && ['chapter', 'outline'].includes(item.asset_type),
      );
      if (!acceptedChanges.length) return { success: true, chapters: [] };

      const response = await sessionAPI.applyChangeSet(projectId, {
        language: requestLanguage,
        changes: acceptedChanges,
      });
      const result = response?.data || {};
      if (!result.success) {
        await mutateSWR(['change-set-recovery', projectId]);
        throw new Error(result.journal_id ? '写入中断，请在恢复预览中核对已写入内容并选择续做。' : result.reason || 'revision_conflict');
      }

      const chapterChanges = acceptedChanges.filter((item) => item.asset_type === 'chapter' && item.asset_id);
      const outlineChanged = acceptedChanges.some((item) => item.asset_type === 'outline');
      const contentByChapter = projectAcceptedChapterContents(chapterChanges);

      if (chapterChanges.length) {
        setManualContentByChapter((prev) => ({ ...(prev || {}), ...contentByChapter }));
        await Promise.all(
          chapterChanges.map((item) =>
            mutateSWR(['chapter', projectId, String(item.asset_id)], String(item.revised || ''), false),
          ),
        );
        const activeContent = contentByChapter[activeChapterKeyRef.current];
        if (activeContent !== undefined) {
          setManualContent(activeContent);
          dispatch({ type: 'SET_WORD_COUNT', payload: countWords(activeContent, writingLanguage) });
          dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
          dispatch({ type: 'SET_SAVED' });
        }
        await loadChapters();
        await Promise.all([
          mutateSWR(`/drafts/${projectId}/chapters`),
          mutateSWR(`/drafts/${projectId}/summaries`),
        ]);
      }
      if (outlineChanged) {
        window.dispatchEvent(new CustomEvent('wenshape:outline-updated', { detail: { projectId } }));
      }

      const chapters = [...new Set(chapterChanges.map((item) => String(item.asset_id)))];
      const runAnalysisSync = async (targetChapters, effect) => {
        setCanonTurnState({
          chapter: targetChapters.join(', '),
          effect,
          status: 'syncing',
          result: null,
        });
        try {
          const syncResponse = await sessionAPI.analyzeSync(projectId, {
            language: requestLanguage,
            chapters: targetChapters,
          });
          const syncResult = syncResponse?.data || {};
          const failed = (syncResult.results || []).filter((item) => item?.success === false);
          if (!syncResult.success || failed.length) {
            throw new Error(failed.map((item) => `${item.chapter}: ${item.error || 'analysis_failed'}`).join('; '));
          }
          await mutateSWR([projectId, 'facts-tree']);
          await loadChapters();
          await mutateSWR(`/drafts/${projectId}/summaries`);
          setCanonTurnState({
            chapter: targetChapters.join(', '),
            effect,
            status: 'applied',
            result: syncResult,
          });
          pushNotice(t('writingSession.factsAutoSynced'));
        } catch (error) {
          setCanonTurnState({
            chapter: targetChapters.join(', '),
            effect,
            status: 'failed',
            result: null,
          });
          pushNotice(t('writingSession.factsAutoSyncFailed') + extractErrorDetail(error));
        }
      };
      if (chapters.length === 1 && turnEffect) {
        const chapter = chapters[0];
        canonSyncPendingRef.current.set(`${projectId}:${chapter}`, turnEffect);
        const effectResult = await applyAcceptedTurnEffect(projectId, chapter);
        const changeType = String(turnEffect.change_type || 'conversation');
        if (!effectResult?.applied && ['chapter_write', 'plot_edit'].includes(changeType)) {
          await runAnalysisSync(chapters, turnEffect);
        }
      } else if (chapters.length > 0) {
        const syntheticEffect = { change_type: 'chapter_write', fact_operation: 'replace_chapter' };
        await runAnalysisSync(chapters, syntheticEffect);
      }

      return { success: true, chapters, result };
    },
    [applyAcceptedTurnEffect, dispatch, loadChapters, projectId, pushNotice, requestLanguage, t, writingLanguage],
  );

  const persistAcceptedAgentContent = useCallback(
    async (chapter, content, turnEffect = null, chapterTarget = null, changes = []) => {
      const targetChapter = String(chapter || '');
      if (!targetChapter) return;
      const currentInfo = chapterInfoRef.current || {};
      const title =
        String(chapterTarget?.title || '').trim() ||
        (String(currentInfo.chapter || '') === targetChapter
          ? String(currentInfo.chapter_title || '').trim() || null
          : null);
      try {
        if (turnEffect) {
          setCanonTurnState({ chapter: targetChapter, effect: turnEffect, status: 'saving', result: null });
        }
        const acceptedChanges = Array.isArray(changes) ? changes.filter((item) => item && typeof item === 'object') : [];
        let saved = null;
        if (acceptedChanges.length) {
          await applyAcceptedChangeSet(acceptedChanges, turnEffect);
          saved = { success: true };
        } else {
          saved = await queueAutosave(
            { projectId, chapter: targetChapter, content, title },
            { immediate: true, createBackup: true, turnEffect },
          );
        }
        if (saved && chapterTarget?.create) {
          await loadChapters();
          dispatch({
            type: 'SET_ACTIVE_DOCUMENT',
            payload: { type: 'chapter', id: targetChapter, title: title || '' },
          });
        }
      } catch (error) {
        setCanonTurnState((prev) => (prev ? { ...prev, status: 'failed', result: null } : prev));
        pushNotice(`Agent 修改未提交：${extractErrorDetail(error)}`);
      }
    },
    [applyAcceptedChangeSet, dispatch, loadChapters, projectId, pushNotice, queueAutosave],
  );

  const handleAcceptAllDiff = () => {
    if (!diffReview) return;
    const nextContent = diffReview.revisedContent || '';
    const targetChapter = String(diffReview.chapterKey || activeChapterKeyRef.current || '');
    if (diffReview.assetType === 'outline') {
      const changes = diffReview.changeSet || [];
      clearDiffReview();
      void applyAcceptedChangeSet(changes, diffReview.turnEffect || null)
        .catch((error) => pushNotice(`Agent 修改未提交：${extractErrorDetail(error)}`));
      return;
    }
    if ((loadedContent ?? '') !== nextContent) {
      dispatch({ type: 'SET_UNSAVED' });
    }
    if (activeChapterKeyRef.current === targetChapter) setManualContent(nextContent);
    if (targetChapter) {
      setManualContentByChapter((prev) => ({ ...(prev || {}), [targetChapter]: nextContent }));
    }
    if (activeChapterKeyRef.current === targetChapter) {
      dispatch({ type: 'SET_WORD_COUNT', payload: countWords(nextContent, writingLanguage) });
      dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
    }
    clearDiffReview();
    void persistAcceptedAgentContent(
      targetChapter,
      nextContent,
      diffReview.turnEffect || null,
      diffReview.chapterTarget || null,
      diffReview.changeSet || [],
    );
  };

  const handleRejectAllDiff = () => {
    if (!diffReview) return;
    if (diffReview.assetType === 'outline') {
      clearDiffReview();
      return;
    }
    const nextContent = diffReview.originalContent || '';
    const targetChapter = String(diffReview.chapterKey || activeChapterKeyRef.current || '');
    if ((loadedContent ?? '') !== nextContent) {
      dispatch({ type: 'SET_UNSAVED' });
    }
    if (activeChapterKeyRef.current === targetChapter) setManualContent(nextContent);
    if (targetChapter) {
      setManualContentByChapter((prev) => ({ ...(prev || {}), [targetChapter]: nextContent }));
    }
    if (activeChapterKeyRef.current === targetChapter) {
      dispatch({ type: 'SET_WORD_COUNT', payload: countWords(nextContent, writingLanguage) });
      dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
    }
    clearDiffReview();
  };

  const handleAcceptDiffHunk = (hunkId) => {
    setDiffDecisions((prev) => {
      const next = { ...(prev || {}) };
      const current = next[hunkId];
      next[hunkId] = current === 'accepted' ? 'pending' : 'accepted';
      return next;
    });
  };

  const openChangeAsset = useCallback(
    (item, changeSet) => {
      if (!item) {
        clearDiffReview();
        return;
      }
      const original = String(item.original || '');
      const revised = String(item.revised || '');
      const diff = buildLineDiff(original, revised, { contextLines: 2 });
      const hunks = (diff.hunks || []).map((hunk) => ({ ...hunk, reason: t('writingSession.draftDiffReason') }));
      setDiffDecisions(hunks.reduce((acc, hunk) => ({ ...acc, [hunk.id]: 'accepted' }), {}));
      setDiffReview((prev) => ({
        ...diff,
        hunks,
        originalContent: original,
        revisedContent: revised,
        chapterKey: item.asset_type === 'chapter' ? String(item.asset_id || '') : String(prev?.chapterKey || ''),
        assetType: String(item.asset_type || 'chapter'),
        assetId: String(item.asset_id || ''),
        chapterTarget: item.chapter_target || null,
        turnEffect: prev?.turnEffect || null,
        changeSet,
      }));
      dispatch({
        type: 'SET_ACTIVE_DOCUMENT',
        payload:
          item.asset_type === 'outline'
            ? { type: 'outline', id: 'outline' }
            : { type: 'chapter', id: String(item.asset_id || '') },
      });
    },
    [clearDiffReview, dispatch, t],
  );

  const handleSelectDiffAsset = (item) => openChangeAsset(item, diffReview?.changeSet || []);

  // 切到哪一章就看哪一章的 diff：待批准的资产可能有多个，而 diffReview 一次只预览一个。
  // 没有这条，作者打开第二章时看不到它的改动，必须先采纳第一章才轮得到（负责人反馈 1）。
  // 只在「该章确有待批准提案且当前预览的不是它」时切换，切换后活动文档已等于该资产 → 收敛不循环。
  useEffect(() => {
    const changeSet = diffReview?.changeSet;
    if (!Array.isArray(changeSet) || changeSet.length < 2) return;
    const doc = state.activeDocument;
    if (!doc) return;
    const wantedType = doc.type === 'outline' ? 'outline' : 'chapter';
    const wantedId = String(doc.id || '');
    if (!wantedId) return;
    if (String(diffReview.assetType || '') === wantedType && String(diffReview.assetId || '') === wantedId) return;
    const match = changeSet.find(
      (item) => String(item?.asset_type || '') === wantedType && String(item?.asset_id || '') === wantedId,
    );
    if (match) openChangeAsset(match, changeSet);
  }, [state.activeDocument, diffReview, openChangeAsset]);

  const handleRejectDiffAsset = (item) => {
    const remaining = (diffReview?.changeSet || []).filter(
      (change) => !(change.asset_type === item.asset_type && String(change.asset_id) === String(item.asset_id)),
    );
    openChangeAsset(remaining[0], remaining);
  };

  const handleAcceptDiffAsset = async (item) => {
    try {
      const isMultiAsset = (diffReview?.changeSet || []).filter((change) => change?.asset_type === 'chapter').length > 1;
      await applyAcceptedChangeSet([item], isMultiAsset ? null : diffReview?.turnEffect || null);
      handleRejectDiffAsset(item);
    } catch (error) {
      pushNotice(`Agent 修改未提交：${extractErrorDetail(error)}`);
    }
  };

  const handleRejectDiffHunk = (hunkId) => {
    setDiffDecisions((prev) => {
      const next = { ...(prev || {}) };
      const current = next[hunkId];
      next[hunkId] = current === 'rejected' ? 'pending' : 'rejected';
      return next;
    });
  };

  const handleApplySelectedDiff = () => {
    if (!diffReview) return;
    const targetChapter = String(diffReview.chapterKey || activeChapterKeyRef.current || '');
    const originalLines = diffReview.originalLines || (diffReview.originalContent || '').split('\n');
    const ops = diffReview.ops || [];
    const hasDecisions = Object.keys(diffDecisions || {}).length > 0;
    const nextContent = hasDecisions
      ? applyDiffOpsWithDecisions(originalLines, ops, diffDecisions)
      : diffReview.revisedContent || '';
    if (diffReview.assetType === 'outline') {
      const changes = (diffReview.changeSet || []).map((item) =>
        item.asset_type === 'outline' && String(item.asset_id || '') === String(diffReview.assetId || 'outline')
          ? { ...item, revised: nextContent }
          : item,
      );
      clearDiffReview();
      void applyAcceptedChangeSet(changes, diffReview.turnEffect || null)
        .catch((error) => pushNotice(`Agent 修改未提交：${extractErrorDetail(error)}`));
      return;
    }
    if ((loadedContent ?? '') !== nextContent) {
      dispatch({ type: 'SET_UNSAVED' });
    }
    if (activeChapterKeyRef.current === targetChapter) setManualContent(nextContent);
    if (targetChapter) {
      setManualContentByChapter((prev) => ({ ...(prev || {}), [targetChapter]: nextContent }));
    }
    if (activeChapterKeyRef.current === targetChapter) {
      dispatch({ type: 'SET_WORD_COUNT', payload: countWords(nextContent, writingLanguage) });
      dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
    }
    setCanonTurnState((prev) =>
      prev?.status === 'pending_acceptance' && String(prev.chapter || '') === targetChapter ? null : prev,
    );
    clearDiffReview();
    const changes = (diffReview.changeSet || []).map((item) =>
      item.asset_type === 'chapter' && String(item.asset_id || '') === targetChapter
        ? { ...item, revised: nextContent }
        : item,
    );
    void persistAcceptedAgentContent(
      targetChapter,
      nextContent,
      diffReview.turnEffect || null,
      diffReview.chapterTarget || null,
      changes,
    );
  };

  const saveDraftContent = async () => {
    if (!chapterInfo.chapter) return { success: false };
    const trimmedTitle = String(chapterInfo.chapter_title || '').trim();
    const saved = await queueAutosave(
      {
        projectId,
        chapter: chapterInfo.chapter,
        content: manualContent,
        title: trimmedTitle || null,
      },
      { immediate: true, createBackup: true },
    );
    if (saved) {
      dispatch({ type: 'SET_SAVED' });
    }
    return { success: saved, chapter: chapterInfo.chapter, title: trimmedTitle || null };
  };

  const saveRegisteredTargets = async () => {
    const dirtyTargets = saveTargets.filter((target) => target.isDirty?.());
    if (!dirtyTargets.length) return true;
    const results = await Promise.allSettled(dirtyTargets.map((target) => target.save()));
    const failed = results.find((result) => result.status === 'rejected' || result.value === false);
    if (failed) {
      if (failed.status === 'rejected') throw failed.reason;
      throw new Error(t('common.saveFailed'));
    }
    return true;
  };

  const handleManualSave = async () => {
    setIsSaving(true);
    try {
      const result = chapterInfo.chapter ? await saveDraftContent() : { success: true };
      await saveRegisteredTargets();
      if (result?.success) {
        if (chapterInfo.chapter) addMessage('system', '\u8349\u7a3f\u5df2\u4fdd\u5b58');
        else pushNotice(t('common.saved'));
      }
    } catch (e) {
      const message = '\u4fdd\u5b58\u5931\u8d25: ' + extractErrorDetail(e);
      if (chapterInfo.chapter) addMessage('error', message);
      else pushNotice(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAnalyzeAndSave = async () => {
    if (!chapterInfo.chapter) return;
    setAnalysisLoading(true);
    try {
      const saved = await saveDraftContent();
      if (!saved?.success) {
        throw new Error(saved?.message || '\u4fdd\u5b58\u5931\u8d25');
      }
      const normalizedChapter = saved?.chapter || chapterInfo.chapter;
      const resp = await sessionAPI.analyze(projectId, {
        language: requestLanguage,
        chapter: normalizedChapter,
        content: manualContent,
        chapter_title: chapterInfo.chapter_title || '',
      });
      if (resp.data?.success) {
        setAnalysisItems([{ chapter: normalizedChapter, analysis: resp.data.analysis || {} }]);
        setAnalysisDialogOpen(true);
        addMessage('system', '\u5206\u6790\u5b8c\u6210，\u8bf7\u786e\u8ba4\u5e76\u4fdd\u5b58\u3002');
      } else {
        throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
      }
    } catch (e) {
      addMessage('error', '\u5206\u6790\u5931\u8d25: ' + extractErrorDetail(e));
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleSaveAnalysis = async (payload) => {
    setAnalysisSaving(true);
    try {
      if (Array.isArray(payload)) {
        const resp = await sessionAPI.saveAnalysisBatch(projectId, {
          language: requestLanguage,
          items: payload,
          overwrite: true,
        });
        if (!resp.data?.success) {
          throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
        }
      } else if (chapterInfo.chapter) {
        const resp = await sessionAPI.saveAnalysis(projectId, {
          language: requestLanguage,
          chapter: chapterInfo.chapter,
          analysis: payload,
          overwrite: true,
        });
        if (!resp.data?.success) {
          throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
        }
      }
      addMessage('system', '\u5206\u6790\u4fdd\u5b58\u5b8c\u6210');
      setAnalysisDialogOpen(false);
      setAnalysisItems([]);
    } catch (e) {
      addMessage('error', '\u4fdd\u5b58\u5931\u8d25: ' + extractErrorDetail(e));
    } finally {
      setAnalysisSaving(false);
    }
  };

  // Phase 4.3: Handle user answer for AskUser
  // Card Handlers
  const handleCardSave = async () => {
    if (!activeCard) return false;
    setIsSaving(true);
    try {
      const name = (cardForm.name || '').trim();
      if (!name) {
        throw new Error(t('writingSession.cardNameRequired'));
      }
      const stars = normalizeStars(cardForm.stars);
      const aliases = parseListInput(cardForm.aliases);
      if (activeCard.type === 'character') {
        const payload = {
          name,
          description: cardForm.description || '',
          aliases,
          stars,
        };
        if (activeCard.isNew || !activeCard.originalName) {
          await cardsAPI.createCharacter(projectId, payload);
        } else if (activeCard.originalName !== name) {
          await cardsAPI.createCharacter(projectId, payload);
          await cardsAPI.deleteCharacter(projectId, activeCard.originalName);
        } else {
          await cardsAPI.updateCharacter(projectId, activeCard.originalName, payload);
        }
      } else {
        const payload = {
          name,
          description: cardForm.description || '',
          aliases,
          category: (cardForm.category || '').trim(),
          stars,
        };
        if (activeCard.isNew || !activeCard.originalName) {
          await cardsAPI.createWorld(projectId, payload);
        } else if (activeCard.originalName !== name) {
          await cardsAPI.createWorld(projectId, payload);
          await cardsAPI.deleteWorld(projectId, activeCard.originalName);
        } else {
          await cardsAPI.updateWorld(projectId, activeCard.originalName, payload);
        }
      }
      try {
        const refreshed =
          activeCard.type === 'character'
            ? await cardsAPI.getCharacter(projectId, name)
            : await cardsAPI.getWorld(projectId, name);
        const refreshedData = refreshed?.data;
        if (refreshedData?.name) {
          setActiveCard({
            ...refreshedData,
            type: activeCard.type,
            isNew: false,
            originalName: refreshedData.name,
          });
          setCardForm({
            name: refreshedData.name || '',
            description: refreshedData.description || '',
            aliases: formatListInput(refreshedData.aliases),
            stars: normalizeStars(refreshedData.stars),
            category: refreshedData.category || '',
          });
        }
      } catch (error) {
        logger.error('Failed to refresh card data', error);
      }
      addMessage('system', t('writingSession.cardUpdated'));
      dispatch({ type: 'SET_SAVED' });
      await saveRegisteredTargets();
      return true;
    } catch (e) {
      addMessage('error', t('writingSession.cardSaveFailed') + extractErrorDetail(e));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCardFormChange = useCallback((patch) => {
    setCardForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleCloseCardEditor = useCallback(() => {
    setStatus('idle');
    setActiveCard(null);
  }, []);

  // ── 编辑器标签 ─────────────────────────────────────────────
  const handleSelectTab = useCallback(
    (tab) => {
      if (!tab || tab.key === tabKeyOf(state.activeDocument)) return;
      captureEditorViewState();
      dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: documentOf(tab) });
    },
    [captureEditorViewState, dispatch, state.activeDocument],
  );

  const handleCloseTab = useCallback(
    (tab) => {
      if (!tab) return;
      captureEditorViewState();
      dispatch({ type: 'CLOSE_TAB', payload: tab.key });
    },
    [captureEditorViewState, dispatch],
  );

  const handleCloseOtherTabs = useCallback(
    (tab) => {
      if (!tab) return;
      captureEditorViewState();
      dispatch({ type: 'CLOSE_OTHER_TABS', payload: tab.key });
    },
    [captureEditorViewState, dispatch],
  );

  // 章节标题栏已从写作区移除，双击当前章节标签是唯一改名入口。
  // 这里只更新标题缓冲与标签显示，落盘仍走既有自动保存（标题随 chapterInfo 写进 summary）。
  const handleRenameTab = useCallback(
    (key, title) => {
      const prefix = 'chapter:';
      const chapter = String(key || '').startsWith(prefix) ? String(key).slice(prefix.length) : '';
      if (!chapter || String(chapterInfoRef.current?.chapter || '') !== chapter) return;
      const next = String(title || '').trim();
      if (next === String(chapterInfoRef.current?.chapter_title || '').trim()) return;
      setChapterInfo((prev) => ({ ...prev, chapter_title: next }));
      dispatch({ type: 'RENAME_TAB', payload: { key, title: next } });
      dispatch({ type: 'SET_UNSAVED' });
    },
    [dispatch],
  );

  const handleFontSizeChange = useCallback(
    (delta) => dispatch({ type: 'SET_EDITOR_FONT_SIZE', payload: state.editorFontSize + delta }),
    [dispatch, state.editorFontSize],
  );

  const tabStatusKeys = useMemo(
    () => ({
      active: tabKeyOf(state.activeDocument),
      unsaved: state.unsavedChanges && chapterInfo.chapter ? `chapter:${chapterInfo.chapter}` : null,
      streaming: streamingState.active && streamingChapterKeyRef.current
        ? `chapter:${streamingChapterKeyRef.current}`
        : null,
      diff: diffReview?.chapterKey ? `chapter:${diffReview.chapterKey}` : null,
    }),
    [chapterInfo.chapter, diffReview, state.activeDocument, state.unsavedChanges, streamingState.active],
  );

  const handleManualSelectionChange = useCallback(
    (value, selectionStart, selectionEnd) => {
      const stats = getSelectionStats(value, selectionStart, selectionEnd, writingLanguage);
      dispatch({ type: 'SET_SELECTION_COUNT', payload: stats.selectionCount });
      setSelectionInfo({
        start: stats.selectionStart,
        end: stats.selectionEnd,
        text: stats.selectionText || '',
        chapter: chapterInfo.chapter,
        sourceText: value,
      });
      const lines = stats.cursorText.split('\n');
      dispatch({
        type: 'SET_CURSOR_POSITION',
        payload: {
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
        },
      });
      // 持续记录位置：切到大纲/卡片不经过 handleChapterSelect，靠这里兜住。
      captureEditorViewState();
    },
    [captureEditorViewState, chapterInfo.chapter, dispatch, writingLanguage],
  );

  const handleManualContentChange = useCallback(
    (nextValue, selectionStart, selectionEnd) => {
      setManualContent(nextValue);
      if (chapterInfo.chapter) {
        const key = String(chapterInfo.chapter);
        setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: nextValue }));
        // 记录这次改动确实出自作者之手，供 autosave 空内容护栏放行主动清空。
        lastUserInputRef.current = { chapter: key, content: nextValue };
      }
      dispatch({ type: 'SET_WORD_COUNT', payload: countWords(nextValue, writingLanguage) });
      handleManualSelectionChange(nextValue, selectionStart, selectionEnd);
      dispatch({ type: 'SET_UNSAVED' });
    },
    [chapterInfo.chapter, dispatch, handleManualSelectionChange, writingLanguage],
  );

  const handleExecutePlan = async (planArg = null) => {
    const plan0 = planArg || pendingPlan;
    if (!plan0?.id || planExecuting) return;
    setPlanExecuting(true);
    addMessage('system', t('writingSession.planExecuting') || '开始执行计划…');
    try {
      const resp = await sessionAPI.executePlan(projectId, plan0.id);
      const plan = resp?.data?.plan;
      const ok = resp?.data?.success;
      const stepsArr = Array.isArray(plan?.steps) ? plan.steps : [];
      // 保留执行后的 per-step status：卡片据此渲染 done / failed / interrupted 终态，
      // 中断不得伪装为完成（plan.md §4 / §9.6 Step 2）。
      if (stepsArr.length) setPendingPlan((prev) => (prev ? { ...prev, ...plan } : prev));
      // U9：plan 步骤只产提案、不落盘（对齐 U8「所有写入先形成 diff」）。
      // 把各步 change_set 汇总交给既有 diff 通道审阅采纳——不新建采纳路径。
      const planChangeSet = stepsArr.flatMap((s) => (Array.isArray(s?.change_set) ? s.change_set : []));
      if (planChangeSet.length) {
        const primary =
          planChangeSet.find((item) => String(item?.asset_type || '') === 'chapter') || planChangeSet[0];
        const primaryKey = String(primary?.asset_id || '');
        if (primaryKey) {
          // finalizeDraftAsDiff 以 streamOriginalByChapterRef 作为 diff 基线；plan 路径没有流式，
          // 不播种会把基线当成空串，导致编辑器正文被清空。
          // 多章计划里每个章节都各自播种：只播种 primary 会让其余章节落回「未知」，
          // 而它们同样会进入 diff 审阅与后续的缓存写入。
          // 只播种带 original 的 chapter 资产——primary 可能是 outline，或后端没给出原文，
          // 那两种情况都必须停在「未知」，不能就地补一个空串。
          for (const [assetId, originalText] of chapterBaselineEntries(planChangeSet)) {
            seedBaseline(streamOriginalByChapterRef.current, assetId, originalText);
          }
          finalizeDraftAsDiff(primaryKey, String(primary?.revised || ''), null, null, planChangeSet);
        }
      }
      const done = stepsArr.filter((s) => s.status === 'done').length;
      const total = stepsArr.length;
      const failed = stepsArr.find((s) => s.status === 'failed');
      if (ok) {
        addMessage('assistant', `${t('writingSession.planDone') || '计划已执行完成'}（${done}/${total}）`);
      } else {
        addMessage(
          'error',
          `${t('writingSession.planFailed') || '计划执行中断'}（${done}/${total}）${failed ? `：${failed.error || ''}` : ''}`,
        );
      }
    } catch (err) {
      addMessage('error', (t('writingSession.planFailed') || '计划执行中断') + extractErrorDetail(err));
    } finally {
      setPlanExecuting(false);
    }
  };

  const handleDismissPlan = () => {
    if (planExecuting) return;
    setPendingPlan(null);
  };

  const handleChatSubmit = async (text, options = {}) => {
    const { silent = false } = options || {};
    if (!silent) addMessage('user', text);
    setWritingMemoryTurn(null);
    setCanonTurnState(null);
    const chapterKey = chapterInfo.chapter ? String(chapterInfo.chapter) : '';
    const requestChapterKey = chapterKey || NO_CHAPTER_KEY;
    activeChatPromptRef.current = { text, chapter: chapterKey };

    // 统一交给后端单 Writer 主循环；无当前章节时，Writer 可自行判断是否先调用 create_chapter。
    // Agent 写作内容经 WS 流式 diff（useWritingSessionRealtime → finalizeDraftAsDiff），失败时明确返回未完成，
    // 不再切换到旧的多 Agent workflow。
    setIsGenerating(true);
    if (chatRecoveryTimerRef.current) {
      window.clearTimeout(chatRecoveryTimerRef.current);
      chatRecoveryTimerRef.current = null;
    }
    serverStreamActiveRef.current = false;
    serverStreamUsedRef.current = false;
    // 只在确有已知正文时播种基线；未加载过的章节保持「未知」，不伪造成空串。
    seedBaseline(
      streamOriginalByChapterRef.current,
      requestChapterKey,
      chapterKey ? (manualContentByChapterRef.current?.[chapterKey] ?? manualContent) : '',
    );
    try {
      const selectionPayload = await buildChatSelection(
        attachedSelection?.text ? attachedSelection : selectionInfo,
        chapterKey,
        manualContent,
      );
      const resp = await sessionAPI.chat(projectId, {
        request_id: crypto.randomUUID(),
        chapter: chapterKey,
        conversation_id: activeConversationId || undefined,
        message: text,
        ...selectionPayload,
        has_draft: Boolean(chapterKey) && !canUseWriter,
        reasoning_level: reasoningLevel,
      });
      const data = resp?.data || {};
      if (data.history_persisted === false) {
        addMessage('error', '本轮答复已生成，但历史保存失败，请保留当前页面中的答复。');
      }
      const chapterTarget = data.chapter_target || null;
      const resultChapter = String(chapterTarget?.chapter || chapterKey || '');
      if (data.writing_memory) {
        await mutateMemoryPack(data.writing_memory, false);
        setWritingMemoryTurn({ chapter: resultChapter, status: data.writing_memory });
      }
      if (data.turn_effect) {
        setCanonTurnState({
          chapter: resultChapter,
          effect: data.turn_effect,
          status: data.changed ? 'pending_acceptance' : 'skipped',
          result: null,
        });
        setDiffReview((prev) =>
          prev && String(prev.chapterKey || '') === resultChapter
            ? { ...prev, turnEffect: data.turn_effect, chapterTarget }
            : prev,
        );
      }
      const turnView = normalizeChatTurnResponse(data);
      setAgentTurnMeta(turnView.contextPlan || turnView.runtime ? turnView : null);

      if (turnView.terminalState === 'requires_input') {
        // 只有当后端真的给出（模型生成的）问题时才弹反问对话框；否则不伪造"固定问题"，
        // 而是给一句清晰的系统提示并回到 idle，避免"有反问但模型没参与"+跳过后卡死。
        if (openClarification(data, { text, chapter: resultChapter })) {
          return;
        }
        const hint =
          data.reason === 'draft_required'
            ? '当前章节还没有正文。直接说「写这一章…」我就新建撰写；若要编辑，请先切换到已有正文的章节。'
            : data.reason === 'chapter_required'
              ? '请先选择或新建一个章节作为写作目标，再下达指令。'
              : '我需要更明确的要求才能继续，请补充关键信息后重新发送。';
        addMessage('system', hint);
        setStatus('idle');
        setIsGenerating(false);
        return;
      }

      const terminalCopy = terminalStateMessage(turnView);
      if (terminalCopy) {
        addMessage(turnView.terminalState === 'failed' ? 'error' : 'system', terminalCopy);
        setIsGenerating(false);
        return;
      }

      if (data.action === 'plan' && data.plan) {
        // U9：计划由任务 dock 呈现（步骤 + 逐步进度 + 每个文件的批准入口）。
        // 此处此前只 addMessage 列出步骤而**从未 setPendingPlan**，导致 dock 永不出现、
        // 计划也无从执行——U9 之前 plan 路由对自然说法不触发，这条断链一直没被发现。
        // 不再写系统消息：与 dock 内容重复，且对齐 U8「可见对话只含真实 user/assistant 消息」。
        setPendingPlan(data.plan);
        setIsGenerating(false);
        // 计划无需作者批准，直接执行（负责人决策）；作者的批准点在「编辑」页逐文件采纳。
        void handleExecutePlan(data.plan);
        return;
      }

      if (data.action === 'reply') {
        addMessage('assistant', data.message || '我已理解你的要求，正在结合当前正文继续处理。');
        setIsGenerating(false);
        return;
      }

      if (data.summary && !serverStreamUsedRef.current) {
        addMessage('assistant', data.summary);
      }

      // WebSocket 是主交付路径；HTTP 正文用于连接抖动、重连或缺少 stream_end 时恢复。
      if (data.changed) {
        chatRecoveryTimerRef.current = window.setTimeout(() => {
          chatRecoveryTimerRef.current = null;
          const streamCompleted = serverStreamUsedRef.current && !serverStreamActiveRef.current;
          if (streamCompleted) return;

          if (shouldRecoverChangedTurn(data, serverStreamUsedRef.current, serverStreamActiveRef.current)) {
            serverStreamActiveRef.current = false;
            streamingChapterKeyRef.current = null;
            streamBufferByChapterRef.current[requestChapterKey] = '';
            streamTextByChapterRef.current[requestChapterKey] = '';
            setStreamingState({
              active: false,
              progress: 100,
              current: data.content.length,
              total: data.content.length,
            });
            finalizeDraftAsDiff(resultChapter, data.content, data.turn_effect || null, chapterTarget);
          }
          setIsGenerating(false);
          setStatus('waiting_feedback');
        }, 500);
      } else {
        setIsGenerating(false);
      }
    } catch (e) {
      addMessage('error', (t('writingSession.editFailed') || '操作失败：') + extractErrorDetail(e));
      setIsGenerating(false);
      setStatus('waiting_feedback');
    }
  };

  const handleNewConversation = async () => {
    if (!projectId || isGenerating) return;
    const response = await sessionAPI.createConversation(projectId);
    const created = response?.data?.conversation;
    if (!created?.id) return;
    setActiveConversationId(created.id);
    setConversations((prev) => [{ ...created, active: true }, ...prev.map((item) => ({ ...item, active: false }))]);
    setMessagesByChapter((prev) => ({ ...(prev || {}), [projectChatKey]: [] }));
    setProgressEventsByChapter((prev) => ({ ...(prev || {}), [projectChatKey]: [] }));
    setPendingPlan(null);
    setAgentTurnMeta(null);
    setWritingMemoryTurn(null);
    setCanonTurnState(null);
  };

  const handleSelectConversation = async (conversationId) => {
    if (!projectId || !conversationId || conversationId === activeConversationId || isGenerating) return;
    await sessionAPI.activateConversation(projectId, conversationId);
    const response = await sessionAPI.getHistory(projectId, 0, conversationId);
    const list = Array.isArray(response?.data?.messages) ? response.data.messages : [];
    setActiveConversationId(conversationId);
    setConversations((prev) => prev.map((item) => ({ ...item, active: item.id === conversationId })));
    setMessagesByChapter((prev) => ({
      ...(prev || {}),
      [projectChatKey]: list.map((message) => ({
        type: message?.type === 'activity' ? 'system' : message?.type === 'error' ? 'error' : message?.role || 'system',
        content: String(message?.content ?? ''),
        time: message?.ts ? new Date(message.ts) : new Date(),
      })),
    }));
    setProgressEventsByChapter((prev) => ({ ...(prev || {}), [projectChatKey]: [] }));
    setPendingPlan(null);
    setAgentTurnMeta(null);
    setWritingMemoryTurn(null);
    setCanonTurnState(null);
  };

  const handleRollbackConversation = async (startedAt = 0) => {
    if (!projectId || isGenerating) return null;
    const conversationId = activeConversationId || 'legacy';
    try {
      const response = await sessionAPI.rollbackConversation(projectId, conversationId);
      if (!response?.data?.success) throw new Error(response?.data?.error || '回退失败');
      const history = await sessionAPI.getHistory(projectId, 0, conversationId);
      const list = Array.isArray(history?.data?.messages) ? history.data.messages : [];
      setMessagesByChapter((prev) => ({
        ...(prev || {}),
        [projectChatKey]: list.map((message) => ({
          type: message?.type === 'activity' ? 'system' : message?.type === 'error' ? 'error' : message?.role || 'system',
          content: String(message?.content ?? ''),
          time: message?.ts ? new Date(message.ts) : new Date(),
        })),
      }));
      setProgressEventsByChapter((prev) => ({
        ...(prev || {}),
        [projectChatKey]: (prev?.[projectChatKey] || []).filter(
          (event) => Number(event?.timestamp || 0) < Number(startedAt || 0),
        ),
      }));
      setPendingPlan(null);
      setAgentTurnMeta(null);
      setWritingMemoryTurn(null);
      setCanonTurnState(null);
      clearDiffReview();
      setStatus('waiting_feedback');
      pushNotice(t('agentPanel.rollbackDone'));
      return String(response.data.restored_input || '');
    } catch (error) {
      addMessage('error', `${t('agentPanel.rollbackFailed')}${extractErrorDetail(error)}`);
      return null;
    }
  };

  const handleDeleteConversation = async (conversation) => {
    if (!projectId || !conversation?.id || conversation.id === 'legacy' || isGenerating) return;
    try {
      await sessionAPI.deleteConversation(projectId, conversation.id);
      const response = await sessionAPI.listConversations(projectId);
      const list = Array.isArray(response?.data?.conversations) ? response.data.conversations : [];
      setConversations(list);
      const active = list.find((item) => item.active) || list[0];
      if (active && active.id !== activeConversationId) await handleSelectConversation(active.id);
    } catch (error) {
      logger.error('delete conversation failed', error);
    }
  };

  const showWritingMemory = shouldShowWritingMemory({
    turn: writingMemoryTurn,
    isGenerating,
    isStreaming: streamingState.active,
  });
  const visibleMemoryStatus = showWritingMemory
    ? mergeWritingMemoryStatus(writingMemoryTurn?.status, memoryPackStatus)
    : null;
  const visibleCanonTurnState =
    canonTurnState?.effect && !isGenerating && !streamingState.active ? canonTurnState : null;

  const rightPanelContent = (
    <WritingSessionAgentPanel
      vm={{
        traceEvents,
        agentTraces,
        agentMode,
        setAgentMode,
        canUseWriter,
        agentBusy: agentGenerating,
        t,
        isCancelling,
        handleCancel,
        selectionInfo,
        attachedSelection,
        setAttachedSelection,
        setEditScope,
        editScope,
        memoryPackStatus: visibleMemoryStatus,
        memoryPackLoading: showWritingMemory && memoryPackLoading,
        memoryPackChapter: writingMemoryTurn?.chapter || memoryPackChapter,
        showWritingMemory,
        canonTurnState: visibleCanonTurnState,
        progressEvents,
        messages,
        chapterInfo,
        diffReview,
        diffDecisions,
        handleAcceptAllDiff,
        handleRejectAllDiff,
        handleApplySelectedDiff,
        handleSelectDiffAsset,
        handleAcceptDiffAsset,
        handleRejectDiffAsset,
        addMessage,
        handleChatSubmit,
        countWords,
        writingLanguage,
        dialogMaxChars,
        reasoningLevel,
        reasoningLevels,
        reasoningSupported: Boolean(reasoningCapability?.supported),
        onReasoningLevelChange: handleReasoningLevelChange,
        agentMention,
        pendingPlan,
        agentTurnMeta,
        planExecuting,
        planActiveStepId,
        planStepRuntime,
        onDismissPlan: handleDismissPlan,
        clarification,
        onClarificationConfirm: handleChatClarificationConfirm,
        onClarificationSkip: handleChatClarificationSkip,
        conversations,
        onDeleteConversation: handleDeleteConversation,
        activeConversationId,
        onNewConversation: handleNewConversation,
        onSelectConversation: handleSelectConversation,
        onRollbackConversation: handleRollbackConversation,
      }}
    />
  );

  const saveBusy = isSaving || analysisLoading || analysisSaving;
  const saveAction = chapterInfo.chapter && status !== 'card_editing' ? (
      <SaveMenu
        disabled={saveBusy}
        busy={saveBusy}
        onSaveOnly={handleManualSave}
        onAnalyzeSave={handleAnalyzeAndSave}
      />
    ) : (
      <button
        type="button"
        onClick={status === 'card_editing' ? handleCardSave : handleManualSave}
        disabled={saveBusy || (!projectId && status !== 'card_editing')}
        className="flex items-center gap-2 rounded-[6px] bg-[var(--vscode-list-active)] px-3 py-1.5 text-sm text-[var(--vscode-list-active-fg)] transition-colors hover:opacity-90 disabled:opacity-50"
        title={t('common.save')}
      >
        <Save size={14} />
        <span>{saveBusy ? t('common.processing') : t('common.save')}</span>
      </button>
    );

  const titleBarProps = {
    projectName: project?.name,
    currentChapter: chapterInfo.chapter,
    rightActions: saveAction,
    // Show Card Name in Title if card editing
    chapterTitle:
      status === 'card_editing'
        ? cardForm.name
        : chapterInfo.chapter
          ? chapterInfo.chapter_title || t('writingSession.chapterFallback').replace('{n}', chapterInfo.chapter)
          : null,
    aiHint: null,
  };

  const refreshRecoveredAssets = async (assets) => {
    const chapters = assets.filter((asset) => asset.asset_type === 'chapter');
    const entries = await Promise.all(chapters.map(async (asset) => {
      const key = ['chapter', projectId, asset.asset_id];
      const content = await fetchChapterContent(key);
      await mutateSWR(key, content, false);
      return [asset.asset_id, content];
    }));
    const contentByChapter = Object.fromEntries(entries);
    if (prevProjectIdRef.current !== projectId) return;
    setManualContentByChapter((prev) => ({ ...prev, ...contentByChapter }));
    if (Object.hasOwn(contentByChapter, activeChapterKeyRef.current)) {
      setManualContent(contentByChapter[activeChapterKeyRef.current]);
      dispatch({ type: 'SET_SAVED' });
    }
    if (assets.some((asset) => asset.asset_type === 'outline')) {
      window.dispatchEvent(new CustomEvent('wenshape:outline-updated', { detail: { projectId } }));
    }
    clearDiffReview();
    await loadChapters();
  };

  return (
    <IDELayout rightPanelContent={rightPanelContent} titleBarProps={titleBarProps}>
      <div className="flex h-full w-full flex-col">
        <ChangeSetRecovery key={projectId} projectId={projectId} disabled={isGenerating || state.unsavedChanges}
          onRecovered={refreshRecoveredAssets} />
        <div className="min-h-0 flex-1">
        <WritingSessionMainContent
          vm={{
            activeActivity: state.activeActivity,
            activeDocument: state.activeDocument,
            projectId,
            dispatch,
            status,
            activeCard,
            cardForm,
            onCardFormChange: handleCardFormChange,
            onCloseCardEditor: handleCloseCardEditor,
            chapterInfo,
            chapterLoadError,
            chapterLoading,
            manualContent,
            writingLanguage,
            t,
            state,
            tabs: state.openTabs,
            tabStatusKeys,
            fontSize: state.editorFontSize,
            onFontSizeChange: handleFontSizeChange,
            onSelectTab: handleSelectTab,
            onCloseTab: handleCloseTab,
            onCloseOtherTabs: handleCloseOtherTabs,
            onRenameTab: handleRenameTab,
            editorRef: attachEditor,
            onEditorScroll: captureEditorViewState,
            diffReview,
            diffDecisions,
            onAcceptDiffHunk: handleAcceptDiffHunk,
            onRejectDiffHunk: handleRejectDiffHunk,
            isDiffReviewForActiveChapter,
            isStreamingForActiveChapter,
            streamOriginalContent: readBaseline(streamOriginalByChapterRef.current, activeChapterKey),
            onManualContentChange: handleManualContentChange,
            onManualSelectionChange: handleManualSelectionChange,
          }}
        />
        </div>
      </div>

      {notice ? (
        <div
          key={notice.id}
          className="fixed bottom-4 right-4 z-[60] max-w-[420px] rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] px-3 py-2 text-xs text-[var(--vscode-fg)] shadow-md"
        >
          {notice.text}
        </div>
      ) : null}

      <ChapterCreateDialog
        open={showChapterDialog}
        onClose={() => {
          setShowChapterDialog(false);
          dispatch({ type: 'CLOSE_CREATE_CHAPTER_DIALOG' });
        }}
        onConfirm={handleChapterCreate}
        existingChapters={chapters.map((c) => ({ id: c, title: '' }))}
        volumes={volumes}
        defaultVolumeId={state.selectedVolumeId || 'V1'}
      />

      <AnalysisReviewDialog
        open={analysisDialogOpen}
        analyses={analysisItems}
        onCancel={() => {
          setAnalysisDialogOpen(false);
          setAnalysisItems([]);
        }}
        onSave={handleSaveAnalysis}
        saving={analysisSaving}
      />
    </IDELayout>
  );
}

/**
 * WritingSession - 写作会话入口
 * 提供 IDE 上下文并渲染主容器。
 */
export default function WritingSession(props) {
  const { projectId } = useParams();
  return (
    <IDEProvider projectId={projectId}>
      <WritingSessionContent {...props} />
    </IDEProvider>
  );
}
