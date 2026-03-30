import { useCallback, useRef } from 'react';

/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   防抖请求 Hook - 防止快速点击或频繁变更触发的重复 API 请求
 *   Debounced request hook to prevent duplicate API calls from rapid clicks/changes.
 */

/**
 * 防抖请求 Hook 配置接口 / Debounced request options interface
 */
interface DebouncedRequestOptions {
  /** 最小调用间隔时间（毫秒）/ Minimum interval between calls (ms) */
  debounceMs?: number;
  /** 是否跳过进行中的请求，防止重复请求 / If true, skip call when a previous one is still in-flight */
  dedup?: boolean;
}

/**
 * 防抖请求 Hook 返回值接口 / Debounced request result interface
 */
interface DebouncedRequestResult<T> {
  /** 执行防抖请求的函数 / Function to execute debounced request */
  execute: (...args: unknown[]) => Promise<T | null>;
  /** 取消待处理的请求 / Cancel pending request */
  cancel: () => void;
  /** 当前是否在加载中（只读） / Whether request is in-flight (read-only) */
  readonly loading: boolean;
}

/**
 * 防抖和去重 API 请求 Hook
 *
 * React Hook for debouncing and deduplicating async requests.
 * Prevents duplicate requests from rapid user interactions or re-renders.
 * Implements automatic deduplication and cancellation capabilities.
 *
 * @template T - 请求返回值类型 / Request return value type
 * @param {Function} requestFn - 要执行的异步请求函数 / Async request function to execute
 * @param {DebouncedRequestOptions} [options={}] - 配置选项 / Configuration options
 * @param {number} [options.debounceMs=300] - 防抖延迟时间 / Debounce delay in milliseconds
 * @param {boolean} [options.dedup=true] - 是否启用去重 / Whether to enable deduplication
 * @returns {DebouncedRequestResult<T>} 防抖请求执行器 / Debounced request executor
 *
 * @example
 * const { execute, cancel, loading } = useDebouncedRequest(
 *   (query) => api.search(query),
 *   { debounceMs: 500, dedup: true }
 * );
 *
 * // 使用 / Usage
 * const handleSearch = async (query) => {
 *   const result = await execute(query);
 *   if (result) console.log('Search result:', result);
 * };
 */
export function useDebouncedRequest<T = unknown>(
  requestFn: (...args: unknown[]) => Promise<T>,
  options: DebouncedRequestOptions = {},
): DebouncedRequestResult<T> {
  const { debounceMs = 300, dedup = true } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const loadingRef = useRef(false);
  // Track the latest requestFn to avoid stale closures.
  const fnRef = useRef(requestFn);
  fnRef.current = requestFn;

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const execute = useCallback(
    (...args: unknown[]): Promise<T | null> =>
      new Promise((resolve, reject) => {
        // Dedup: if a request is already in-flight, skip.
        if (dedup && inflightRef.current) {
          resolve(null);
          return;
        }

        cancel();

        timerRef.current = setTimeout(async () => {
          timerRef.current = null;
          inflightRef.current = true;
          loadingRef.current = true;
          try {
            const result = await fnRef.current(...args);
            resolve(result);
          } catch (err) {
            reject(err);
          } finally {
            inflightRef.current = false;
            loadingRef.current = false;
          }
        }, debounceMs);
      }),
    [debounceMs, dedup, cancel],
  );

  return { execute, cancel, get loading() { return loadingRef.current; } };
}

export default useDebouncedRequest;
