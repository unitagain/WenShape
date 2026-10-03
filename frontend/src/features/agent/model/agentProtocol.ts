export type AgentTerminalState =
  | 'completed'
  | 'requires_input'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

export interface ChatTurnRequest {
  chapter?: string;
  conversation_id?: string;
  request_id?: string;
  message: string;
  has_selection?: boolean;
  /** 完整选区原文；范围使用 Unicode 字符位置。 */
  selection_text?: string;
  selection?: { chapter: string; source_sha256: string; start: number; end: number };
  has_draft?: boolean;
  target_word_count?: number;
  auto_execute_plan?: boolean;
  thinking?: boolean;
  reasoning_level?: 'auto' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface ChatTurnResponse {
  history_persisted?: boolean;
  success?: boolean;
  action?: string;
  message?: string;
  summary?: string;
  changed?: boolean;
  partial?: boolean;
  content?: string;
  questions?: Array<{
    type?: string;
    key?: string;
    text?: string;
    question?: string;
    reason?: string;
    impact?: string;
    impact_score?: number;
    options?: string[];
    default?: string;
  }>;
  clarification?: {
    decision?: 'ask' | 'proceed';
    reason?: string;
    question_count?: number;
    questions?: Array<Record<string, unknown>>;
    tool?: 'ask_clarification' | string;
  };
  /** Compatibility aliases; the active contract is the Writer tool payload above. */
  clarify_decision?: 'ask' | 'proceed';
  clarify_mode?: 'always' | 'auto' | 'off';
  cancelled?: boolean;
  incomplete?: boolean;
  reason?: string;
  terminal_state?: AgentTerminalState;
  plan?: Record<string, unknown>;
  context_plan?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  writing_memory?: Record<string, unknown>;
  turn_effect?: Record<string, unknown>;
  chapter_target?: {
    chapter?: string;
    title?: string;
    create?: boolean;
  };
}

export function shouldRecoverChangedTurn(data: ChatTurnResponse, streamUsed: boolean, streamActive: boolean): boolean {
  return data.changed === true && typeof data.content === 'string' && (!streamUsed || streamActive);
}

export function clarificationQuestionsFromResponse(data: ChatTurnResponse | null | undefined): Array<Record<string, unknown>> {
  const direct = Array.isArray(data?.questions) ? data.questions : [];
  if (direct.length) return direct;
  return Array.isArray(data?.clarification?.questions) ? data.clarification.questions : [];
}

export function normalizeClarificationQuestionsFromResponse(
  data: ChatTurnResponse | null | undefined,
): Array<Record<string, unknown>> {
  return clarificationQuestionsFromResponse(data)
    .map((question, index) => ({
      type: typeof question?.type === 'string' && question.type ? question.type : 'clarification',
      key:
        typeof question?.key === 'string' && question.key
          ? question.key
          : `${typeof question?.type === 'string' && question.type ? question.type : 'clarification'}-${index}`,
      text:
        typeof question?.text === 'string'
          ? question.text.trim()
          : typeof question?.question === 'string'
            ? question.question.trim()
            : '',
      reason: question?.reason,
      impact: question?.impact,
      impact_score: question?.impact_score,
      options: Array.isArray(question?.options) ? question.options : [],
      default: question?.default,
    }))
    .filter((question) => Boolean(question.text));
}

export interface AgentTurnView {
  terminalState: AgentTerminalState | null;
  contextPlan: Record<string, unknown> | null;
  runtime: Record<string, unknown> | null;
  reason: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function normalizeChatTurnResponse(data: ChatTurnResponse | null | undefined): AgentTurnView {
  return {
    terminalState: data?.terminal_state || null,
    contextPlan: data?.context_plan || null,
    runtime: data?.runtime || null,
    reason: text(data?.reason),
  };
}

export function terminalStateMessage(view: AgentTurnView): string {
  const reasons: Record<string, string> = {
    selection_source_conflict: '选区对应的正文已变化或尚未保存，请保存正文并重新选择。',
    history_unavailable: '历史保存失败，本轮尚未开始，请稍后重试。',
    turn_already_recorded: '该请求已接收，请查看会话历史与任务状态。',
  };
  if (reasons[view.reason]) return reasons[view.reason];
  switch (view.terminalState) {
    case 'requires_input':
      return '需要补充信息后才能继续。';
    case 'incomplete':
      return `本轮未完整完成${view.reason ? `：${view.reason}` : '。'}`;
    case 'failed':
      return `本轮执行失败${view.reason ? `：${view.reason}` : '。'}`;
    case 'cancelled':
      return '本轮已取消。';
    default:
      return '';
  }
}
