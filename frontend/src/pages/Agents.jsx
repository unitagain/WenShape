import { useEffect, useMemo, useState } from 'react';
import { Cpu, Key, Shield, Save, RefreshCw, Bot, Check } from 'lucide-react';
import { Card, Button, Input } from '../components/ui/core';
import { configAPI } from '../api';

function Agents() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [status, setStatus] = useState(null);
  const [defaultProvider, setDefaultProvider] = useState('openai');
  const [agentOverrides, setAgentOverrides] = useState({
    archivist: '',
    writer: '',
    reviewer: '',
    editor: '',
  });
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');

  // Custom Provider State
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');

  // Model Selection State
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-20241022');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat');

  // Model Lists
  const OPENAI_MODELS = [
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ];

  const ANTHROPIC_MODELS = [
    { id: 'claude-4.5-opus', label: 'Claude 4.5 Opus' },
    { id: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
    { id: 'claude-4.5-haiku', label: 'Claude 4.5 Haiku' },
  ];

  const DEEPSEEK_MODELS = [
    { id: 'deepseek-chat', label: 'DeepSeek-V3.2 (非思考模式)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek-V3.2 (思考模式)' },
  ];

  const providers = useMemo(() => status?.providers || [], [status]);
  const configured = useMemo(() => status?.configured || {}, [status]);

  // Filter out mock provider
  const availableProviders = useMemo(() =>
    providers.filter(p => p.id !== 'mock'),
    [providers]
  );

  const providerMeta = (id) => availableProviders.find((x) => x.id === id);

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
  }, [requiredProviders, availableProviders]);

  const load = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const resp = await configAPI.getLLM();
      const data = resp?.data || null;
      setStatus(data);

      const initialDefault = data?.default_provider || data?.selected_provider || 'openai';
      setDefaultProvider(initialDefault === 'mock' ? 'openai' : initialDefault);

      const overrides = data?.agent_overrides;
      if (overrides && typeof overrides === 'object') {
        setAgentOverrides({
          archivist: overrides.archivist === 'mock' ? '' : (overrides.archivist || ''),
          writer: overrides.writer === 'mock' ? '' : (overrides.writer || ''),
          reviewer: overrides.reviewer === 'mock' ? '' : (overrides.reviewer || ''),
          editor: overrides.editor === 'mock' ? '' : (overrides.editor || ''),
        });
      } else {
        setAgentOverrides({ archivist: '', writer: '', reviewer: '', editor: '' });
      }

      // Set masked keys for configured providers
      const configuredProviders = data?.configured || {};
      if (configuredProviders.openai) {
        setOpenaiKey('sk-••••••••••••••••••••');
      } else {
        setOpenaiKey('');
      }
      if (configuredProviders.anthropic) {
        setAnthropicKey('sk-ant-••••••••••••••••');
      } else {
        setAnthropicKey('');
      }
      if (configuredProviders.deepseek) {
        setDeepseekKey('sk-••••••••••••••••••••');
      } else {
        setDeepseekKey('');
      }

      // Custom
      setCustomBaseUrl(data?.custom_base_url || '');
      setCustomModelName(data?.custom_model_name || '');
      if (configuredProviders.custom) {
        setCustomApiKey('sk-custom-••••••••');
      } else {
        setCustomApiKey('');
      }

      // Model selections
      setOpenaiModel(data?.openai_model || 'gpt-4o');
      setAnthropicModel(data?.anthropic_model || 'claude-3-5-sonnet-20241022');
      setDeepseekModel(data?.deepseek_model || 'deepseek-chat');
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

      // Only send keys that have been modified (not masked)
      if (openaiKey.trim() && !openaiKey.includes('••')) payload.openai_api_key = openaiKey.trim();
      if (anthropicKey.trim() && !anthropicKey.includes('••')) payload.anthropic_api_key = anthropicKey.trim();
      if (deepseekKey.trim() && !deepseekKey.includes('••')) payload.deepseek_api_key = deepseekKey.trim();

      // Custom
      if (customApiKey.trim() && !customApiKey.includes('••')) payload.custom_api_key = customApiKey.trim();
      payload.custom_base_url = customBaseUrl;
      payload.custom_model_name = customModelName;

      // Model selections
      payload.openai_model = openaiModel;
      payload.anthropic_model = anthropicModel;
      payload.deepseek_model = deepseekModel;

      await configAPI.updateLLM(payload);
      setSuccess('配置已保存');
      await load();
    } catch (e) {
      setError(String(e?.response?.data?.detail || e?.message || '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
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
              {(availableProviders.length ? availableProviders : [
                { id: 'openai', label: 'OpenAI', requires_key: true },
                { id: 'anthropic', label: 'Anthropic (Claude)', requires_key: true },
                { id: 'deepseek', label: 'DeepSeek', requires_key: true },
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
                    {(availableProviders.length ? availableProviders : [
                      { id: 'openai', label: 'OpenAI' },
                      { id: 'anthropic', label: 'Anthropic (Claude)' },
                      { id: 'deepseek', label: 'DeepSeek' },
                    ]).map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          {/* Provider Configuration - Shows for all providers with different layouts */}
          {defaultProvider !== 'mock' && (
            <Card className="bg-surface lg:col-span-2">
              <div className="p-6 border-b border-border">
                <h3 className="text-lg font-bold text-ink-900 flex items-center gap-2">
                  <Shield size={18} className="text-primary" /> 提供商配置
                </h3>
                <p className="text-sm text-ink-500 mt-1">
                  {defaultProvider === 'custom'
                    ? '配置兼容 OpenAI 接口的第三方模型服务。'
                    : '配置所选提供商的模型参数与密钥。'}
                </p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* OpenAI Configuration */}
                  {defaultProvider === 'openai' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">模型选择</label>
                        <select
                          value={openaiModel}
                          onChange={(e) => setOpenaiModel(e.target.value)}
                          className="px-3 py-2 w-full border border-border rounded bg-surface text-ink-900 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer"
                        >
                          {OPENAI_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                        <p className="text-xs text-ink-400">选择要使用的 OpenAI 模型</p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">API 密钥</label>
                        <Input
                          type="password"
                          value={openaiKey}
                          onChange={(e) => setOpenaiKey(e.target.value)}
                          placeholder={configured?.openai ? '已配置（修改后保存）' : 'sk-...'}
                        />
                        {configured?.openai && (
                          <p className="text-xs text-ink-400">已配置 · 修改后点击保存</p>
                        )}
                      </div>
                    </>
                  )}

                  {/* Anthropic Configuration */}
                  {defaultProvider === 'anthropic' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">模型选择</label>
                        <select
                          value={anthropicModel}
                          onChange={(e) => setAnthropicModel(e.target.value)}
                          className="px-3 py-2 w-full border border-border rounded bg-surface text-ink-900 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer"
                        >
                          {ANTHROPIC_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                        <p className="text-xs text-ink-400">选择要使用的 Claude 模型</p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">API 密钥</label>
                        <Input
                          type="password"
                          value={anthropicKey}
                          onChange={(e) => setAnthropicKey(e.target.value)}
                          placeholder={configured?.anthropic ? '已配置（修改后保存）' : 'sk-ant-...'}
                        />
                        {configured?.anthropic && (
                          <p className="text-xs text-ink-400">已配置 · 修改后点击保存</p>
                        )}
                      </div>
                    </>
                  )}

                  {/* DeepSeek Configuration */}
                  {defaultProvider === 'deepseek' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">模型选择</label>
                        <select
                          value={deepseekModel}
                          onChange={(e) => setDeepseekModel(e.target.value)}
                          className="px-3 py-2 w-full border border-border rounded bg-surface text-ink-900 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer"
                        >
                          {DEEPSEEK_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                        <p className="text-xs text-ink-400">选择要使用的 DeepSeek 模型</p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">API 密钥</label>
                        <Input
                          type="password"
                          value={deepseekKey}
                          onChange={(e) => setDeepseekKey(e.target.value)}
                          placeholder={configured?.deepseek ? '已配置（修改后保存）' : '...'}
                        />
                        {configured?.deepseek && (
                          <p className="text-xs text-ink-400">已配置 · 修改后点击保存</p>
                        )}
                      </div>
                    </>
                  )}

                  {/* Custom Configuration */}
                  {defaultProvider === 'custom' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">基础地址</label>
                        <Input
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1"
                        />
                        <p className="text-xs text-ink-400">API 服务的基础地址，通常以 /v1 结尾</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">模型名称</label>
                        <Input
                          value={customModelName}
                          onChange={(e) => setCustomModelName(e.target.value)}
                          placeholder="my-custom-model"
                        />
                        <p className="text-xs text-ink-400">调用时使用的模型标识符</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-ink-500 uppercase">密钥（可选）</label>
                        <Input
                          type="password"
                          value={customApiKey}
                          onChange={(e) => setCustomApiKey(e.target.value)}
                          placeholder={configured?.custom ? '已配置（修改后保存）' : 'sk-...'}
                        />
                        {configured?.custom && (
                          <p className="text-xs text-ink-400">已配置 · 修改后点击保存</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}


          {/* Status Messages & Save Actions */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface/80 backdrop-blur-md border-t border-border z-50 flex justify-between items-center max-w-5xl mx-auto rounded-t-xl lg:left-[280px]">
            <div className="flex-1 mr-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-center inline-flex">
                  <Shield size={14} className="mr-2" /> {error}
                </div>
              )}
              {success && (
                <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center inline-flex">
                  <Check size={14} className="mr-2" /> {success}
                </div>
              )}
            </div>
            <Button onClick={save} disabled={saving} size="lg" className="shadow-lg">
              {saving ? <RefreshCw className="animate-spin mr-2" /> : <Save className="mr-2" />}
              保存所有配置
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default Agents;
