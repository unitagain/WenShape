import { useEffect, useMemo, useState } from 'react';
import { Cpu, Key, Shield, Save, RefreshCw, Bot } from 'lucide-react';
import { Card, Button, Input } from '../components/ui/core';
import { configAPI } from '../api';

function Agents() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [status, setStatus] = useState(null);
  const [defaultProvider, setDefaultProvider] = useState('mock');
  const [agentOverrides, setAgentOverrides] = useState({
    archivist: '',
    writer: '',
    reviewer: '',
    editor: '',
  });
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');

  const providers = useMemo(() => status?.providers || [], [status]);
  const configured = useMemo(() => status?.configured || {}, [status]);

  const providerMeta = (id) => providers.find((x) => x.id === id);

  const effectiveProviders = useMemo(() => {
    return {
      archivist: agentOverrides.archivist || defaultProvider,
      writer: agentOverrides.writer || defaultProvider,
      reviewer: agentOverrides.reviewer || defaultProvider,
      editor: agentOverrides.editor || defaultProvider,
    };
  }, [agentOverrides, defaultProvider]);

  const requiredProviders = useMemo(() => {
    const set = new Set(Object.values(effectiveProviders));
    return Array.from(set);
  }, [effectiveProviders]);

  const requiredKeyProviders = useMemo(() => {
    return requiredProviders.filter((p) => providerMeta(p)?.requires_key);
  }, [requiredProviders, providers]);

  const load = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const resp = await configAPI.getLLM();
      const data = resp?.data || null;
      setStatus(data);

      const initialDefault = data?.default_provider || data?.selected_provider || 'mock';
      setDefaultProvider(initialDefault);

      const overrides = data?.agent_overrides;
      if (overrides && typeof overrides === 'object') {
        setAgentOverrides({
          archivist: overrides.archivist || '',
          writer: overrides.writer || '',
          reviewer: overrides.reviewer || '',
          editor: overrides.editor || '',
        });
      } else {
        setAgentOverrides({ archivist: '', writer: '', reviewer: '', editor: '' });
      }
    } catch (e) {
      setError(String(e?.response?.data?.detail || e?.message || '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const missing = requiredKeyProviders.filter((p) => !configured?.[p]);
      const missingNeedInput = [];
      for (const p of missing) {
        if (p === 'openai' && !openaiKey.trim()) missingNeedInput.push('OpenAI API Key');
        if (p === 'anthropic' && !anthropicKey.trim()) missingNeedInput.push('Anthropic API Key');
        if (p === 'deepseek' && !deepseekKey.trim()) missingNeedInput.push('DeepSeek API Key');
      }
      if (missingNeedInput.length) {
        setError(`缺少必要的密钥：${missingNeedInput.join('、')}`);
        setSaving(false);
        return;
      }

      const payload = {
        provider: defaultProvider,
        default_provider: defaultProvider,
        agent_providers: {
          archivist: agentOverrides.archivist,
          writer: agentOverrides.writer,
          reviewer: agentOverrides.reviewer,
          editor: agentOverrides.editor,
        },
      };

      if (openaiKey.trim()) payload.openai_api_key = openaiKey.trim();
      if (anthropicKey.trim()) payload.anthropic_api_key = anthropicKey.trim();
      if (deepseekKey.trim()) payload.deepseek_api_key = deepseekKey.trim();

      await configAPI.updateLLM(payload);
      setSuccess('配置已保存');
      setOpenaiKey('');
      setAnthropicKey('');
      setDeepseekKey('');
      await load();
    } catch (e) {
      setError(String(e?.response?.data?.detail || e?.message || '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-ink-900 tracking-tight flex items-center gap-3">
            <Cpu className="text-primary" /> 智能体系统配置
          </h2>
          <p className="text-ink-500 mt-2">配置大语言模型 (LLM) 提供商及各智能体角色的调用策略。</p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin mr-2' : 'mr-2'} /> 刷新配置
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Provider Selection */}
        <Card className="bg-surface">
          <div className="p-6 border-b border-border">
            <h3 className="text-lg font-bold text-ink-900 flex items-center gap-2">
              <Shield size={18} className="text-primary" /> 默认模型提供商
            </h3>
          </div>
          <div className="p-6 space-y-4">
            {(providers.length ? providers : [
              { id: 'openai', label: 'OpenAI', requires_key: true },
              { id: 'anthropic', label: 'Anthropic (Claude)', requires_key: true },
              { id: 'deepseek', label: 'DeepSeek', requires_key: true },
              { id: 'mock', label: 'Mock (Demo)', requires_key: false },
            ]).map((p) => (
              <label
                key={p.id}
                className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-all ${defaultProvider === p.id
                    ? 'bg-primary/5 border-primary shadow-sm'
                    : 'bg-background border-border hover:border-primary/30'
                  }`}
              >
                <div className="flex items-center gap-4">
                  <input
                    type="radio"
                    name="defaultProvider"
                    className="accent-primary h-4 w-4"
                    checked={defaultProvider === p.id}
                    onChange={() => setDefaultProvider(p.id)}
                  />
                  <div>
                    <div className="font-bold text-ink-900">{p.label}</div>
                    <div className="text-xs text-ink-400 mt-0.5">{p.requires_key ? '需要 API 密钥' : '无需密钥'}</div>
                  </div>
                </div>
                <div className="text-xs font-mono font-medium px-2 py-1 rounded bg-gray-100 text-ink-500">
                  {configured?.[p.id] ? '已配置' : p.requires_key ? '未配置' : '可用'}
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* Agent Overrides */}
        <Card className="bg-surface">
          <div className="p-6 border-b border-border">
            <h3 className="text-lg font-bold text-ink-900 flex items-center gap-2">
              <Bot size={18} className="text-primary" /> 角色模型覆盖
            </h3>
            <p className="text-sm text-ink-500 mt-1">为特定智能体指定不同的模型（可选）。默认使用全局设置。</p>
          </div>
          <div className="p-6 space-y-4">
            {[
              { id: 'archivist', title: '资料管理员 (Archivist)' },
              { id: 'writer', title: '撰稿人 (Writer)' },
              { id: 'reviewer', title: '审稿人 (Reviewer)' },
              { id: 'editor', title: '编辑 (Editor)' },
            ].map((row) => (
              <div key={row.id} className="flex items-center justify-between p-3 bg-background rounded-md border border-border/50">
                <span className="text-sm font-medium text-ink-700">{row.title}</span>
                <select
                  value={agentOverrides[row.id]}
                  onChange={(e) => setAgentOverrides((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  className="px-3 py-1.5 border border-border rounded bg-surface text-ink-900 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer ml-4 w-48"
                >
                  <option value="">跟随默认 ({defaultProvider})</option>
                  {(providers.length ? providers : [
                    { id: 'openai', label: 'OpenAI' },
                    { id: 'anthropic', label: 'Anthropic (Claude)' },
                    { id: 'deepseek', label: 'DeepSeek' },
                    { id: 'mock', label: 'Mock (Demo)' },
                  ]).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Card>

        {/* API Keys */}
        <Card className="bg-surface lg:col-span-2">
          <div className="p-6 border-b border-border">
            <h3 className="text-lg font-bold text-ink-900 flex items-center gap-2">
              <Key size={18} className="text-primary" /> API 密钥配置
            </h3>
          </div>
          <div className="p-6">
            {!requiredKeyProviders.length ? (
              <div className="flex items-center justify-center p-8 bg-green-50 text-green-700 border border-green-200 rounded-lg">
                <Shield className="mr-2" size={20} />
                当前配置无需额外的 API 密钥。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {requiredKeyProviders.includes('openai') && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-ink-500 uppercase">OpenAI API Key</label>
                    <Input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder={configured?.openai ? '已配置 (保持空白以维持不变)' : 'sk-...'}
                    />
                  </div>
                )}
                {requiredKeyProviders.includes('anthropic') && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-ink-500 uppercase">Anthropic API Key</label>
                    <Input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder={configured?.anthropic ? '已配置 (保持空白以维持不变)' : 'sk-ant-...'}
                    />
                  </div>
                )}
                {requiredKeyProviders.includes('deepseek') && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-ink-500 uppercase">DeepSeek API Key</label>
                    <Input
                      type="password"
                      value={deepseekKey}
                      onChange={(e) => setDeepseekKey(e.target.value)}
                      placeholder={configured?.deepseek ? '已配置 (保持空白以维持不变)' : '...'}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Status Messages */}
            <div className="mt-6 space-y-3">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 flex items-center">
                  <Shield size={14} className="mr-2" /> {error}
                </div>
              )}
              {success && (
                <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded p-3 flex items-center">
                  <Check size={14} className="mr-2" /> {success}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={save} disabled={saving} size="lg">
                {saving ? <RefreshCw className="animate-spin mr-2" /> : <Save className="mr-2" />}
                保存所有配置
              </Button>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}

// Helper icon
const Check = ({ size, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12"></polyline></svg>
)

export default Agents;
