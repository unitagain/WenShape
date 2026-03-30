/** Shared button component with loading-state support. */

import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

/**
 * 增强按钮组件 / Enhanced Button Component with Loading State
 *
 * 轻量级按钮组件，支持多种样式变体、尺寸和加载状态。
 * 仅处理样式与加载态，不改变业务语义。
 *
 * @component
 * @param {Object} props - 组件 props
 * @param {string} [props.className] - 额外 CSS 类名 / Additional CSS classes
 * @param {string} [props.variant='primary'] - 按钮样式 / Button style variant
 *   - 'primary': 主操作按钮（填充色）
 *   - 'secondary': 次级操作按钮
 *   - 'outline': 边框模式
 *   - 'ghost': 透明背景
 *   - 'destructive': 危险操作（删除等）
 * @param {string} [props.size='default'] - 按钮尺寸 / Button size
 *   - 'sm': 小号 (h-8 px-3 text-xs)
 *   - 'default': 标准 (h-10 px-4)
 *   - 'lg': 大号 (h-12 px-8)
 *   - 'icon': 图标按钮 (h-10 w-10)
 * @param {boolean} [props.isLoading=false] - 是否显示加载状态 / Loading state indicator
 * @param {React.ReactNode} props.children - 按钮内容 / Button content
 * @param {*} props.* - 其他 HTML button 原生属性 / Standard HTML button attributes
 * @returns {JSX.Element} 按钮元素
 *
 * @example
 * <Button variant="primary" isLoading={isSubmitting}>
 *   {isSubmitting ? '提交中...' : '提交'}
 * </Button>
 */
export function Button({ className, variant = "primary", size = "default", isLoading, children, ...props }) {
  const variants = {
    primary: "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border border-[var(--vscode-input-border)] hover:opacity-90",
    secondary: "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] hover:bg-[var(--vscode-list-hover)] border border-[var(--vscode-input-border)]",
    outline: "bg-transparent border border-[var(--vscode-input-border)] text-[var(--vscode-fg)] hover:bg-[var(--vscode-list-hover)]",
    ghost: "bg-transparent hover:bg-[var(--vscode-list-hover)] text-[var(--vscode-fg-subtle)] hover:text-[var(--vscode-fg)]",
    destructive: "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
  };

  const sizes = {
    sm: "h-8 px-3 text-xs",
    default: "h-10 px-4 py-2",
    lg: "h-12 px-8 text-base",
    icon: "h-10 w-10 p-0 flex items-center justify-center"
  };

  return (
    <button 
      className={cn(
        "inline-flex items-center justify-center rounded-[6px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vscode-focus-border)] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
