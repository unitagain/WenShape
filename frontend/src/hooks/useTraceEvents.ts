import { useCallback, useEffect, useRef, useState } from 'react';
import logger from '../utils/logger';

interface TokenUsage {
  total: number;
  max: number;
  breakdown: {
    guiding: number;
    informational: number;
    actionable: number;
  };
}

interface ContextStats {
  token_usage: TokenUsage;
  health: {
    healthy: boolean;
    issues: string[];
  };
}

interface TraceMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface AgentTrace {
  agent_name: string;
  [key: string]: unknown;
}

const getWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/trace`;
};

/**
 * Subscribe to backend trace events over WebSocket.
 * 通过 WebSocket 接收后端追踪事件。
 */
export const useTraceEvents = () => {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [contextStats, setContextStats] = useState<ContextStats>({
    token_usage: {
      total: 0,
      max: 16000,
      breakdown: { guiding: 0, informational: 0, actionable: 0 },
    },
    health: { healthy: true, issues: [] },
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const handleMessage = useCallback((message: TraceMessage): void => {
    const { type, payload } = message;

    if (type === 'trace_event') {
      setEvents((prev) => [...prev, payload]);
      return;
    }

    if (type === 'agent_trace_update') {
      setTraces((prev) => {
        const agentPayload = payload as AgentTrace;
        const index = prev.findIndex((item) => item.agent_name === agentPayload.agent_name);
        if (index < 0) {
          return [...prev, agentPayload];
        }

        const next = [...prev];
        next[index] = { ...next[index], ...agentPayload };
        return next;
      });
      return;
    }

    if (type === 'context_stats_update') {
      setContextStats(payload as unknown as ContextStats);
    }
  }, []);

  const connect = useCallback((): void => {
    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        logger.debug('Trace WebSocket Connected');
        setIsConnected(true);
      };

      ws.onclose = () => {
        logger.debug('Trace WebSocket Disconnected');
        setIsConnected(false);
        window.setTimeout(connect, 3000);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          handleMessage(JSON.parse(event.data));
        } catch (error) {
          logger.error('Failed to parse WS message', error);
        }
      };
    } catch (error) {
      logger.error('WebSocket connection error', error);
    }
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { events, traces, contextStats, isConnected };
};

