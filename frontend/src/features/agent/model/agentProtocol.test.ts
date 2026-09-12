import { describe, expect, it } from 'vitest';
import {
  clarificationQuestionsFromResponse,
  normalizeClarificationQuestionsFromResponse,
  normalizeChatTurnResponse,
  shouldRecoverChangedTurn,
  terminalStateMessage,
} from './agentProtocol';

describe('agentProtocol', () => {
  it('maps terminal states to concise copy', () => {
    expect(terminalStateMessage(normalizeChatTurnResponse({ terminal_state: 'incomplete', reason: 'iteration_limit' }))).toContain('iteration_limit');
  });

  it('recovers changed turns when the websocket stream is missing or incomplete', () => {
    const response = { changed: true, content: '修改后的正文' };

    expect(shouldRecoverChangedTurn(response, false, false)).toBe(true);
    expect(shouldRecoverChangedTurn(response, true, true)).toBe(true);
    expect(shouldRecoverChangedTurn(response, true, false)).toBe(false);
    expect(shouldRecoverChangedTurn({ changed: true }, false, false)).toBe(false);
  });
});

it('reads clarification questions from the nested payload when the top-level alias is absent or empty', () => {
  const nested = [{ text: '本章冲突如何收束？' }];
  expect(clarificationQuestionsFromResponse({ clarification: { questions: nested } })).toEqual(nested);
  expect(clarificationQuestionsFromResponse({ questions: [], clarification: { questions: nested } })).toEqual(nested);
});

it('normalizes realtime clarification questions and drops empty entries', () => {
  expect(
    normalizeClarificationQuestionsFromResponse({
      questions: [
        { type: 'plot', text: '  冲突如何收束？  ', options: ['公开决裂', '暂时和解'] },
        { question: '继续使用当前视角吗？' },
        { text: '   ' },
      ],
    }),
  ).toEqual([
    {
      type: 'plot',
      key: 'plot-0',
      text: '冲突如何收束？',
      reason: undefined,
      impact: undefined,
      impact_score: undefined,
      options: ['公开决裂', '暂时和解'],
      default: undefined,
    },
    {
      type: 'clarification',
      key: 'clarification-1',
      text: '继续使用当前视角吗？',
      reason: undefined,
      impact: undefined,
      impact_score: undefined,
      options: [],
      default: undefined,
    },
  ]);
});
