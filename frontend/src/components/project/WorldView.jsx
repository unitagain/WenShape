import React, { useState, useEffect } from 'react';
import { cardsAPI } from '../../api';
import { Button, Card, Input } from '../ui/core';
import { Plus, Globe, Save, X, Box } from 'lucide-react';

export function WorldView({ projectId }) {
  const [worldCards, setWorldCards] = useState([]);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    description: '',
    rules: [],
    immutable: false
  });

  useEffect(() => {
    loadWorldCards();
  }, [projectId]);

  useEffect(() => {
    if (editing) {
      if (editing.name) {
        setFormData(editing);
      } else {
        // New card
        setFormData({
          name: '',
          category: '',
          description: '',
          rules: [],
          immutable: false
        });
      }
    }
  }, [editing]);

  const loadWorldCards = async () => {
    try {
      const namesResp = await cardsAPI.listWorld(projectId);
      const items = [];
      for (const name of namesResp.data) {
        const resp = await cardsAPI.getWorld(projectId, name);
        items.push(resp.data);
      }
      setWorldCards(items);
    } catch (error) {
      console.error('Failed to load world cards:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing.name && editing.name !== '') {
        await cardsAPI.updateWorld(projectId, editing.name, formData);
      } else {
        await cardsAPI.createWorld(projectId, formData);
      }
      await loadWorldCards();
      setEditing(null);
    } catch (error) {
      alert('Error saving world card: ' + (error.response?.data?.detail || error.message));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Left List */}
      <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-ink-900">世界观设定</h3>
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus size={16} className="mr-2" /> 新建条目
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {worldCards.length === 0 && (
            <div className="text-sm text-ink-400 p-2 font-serif italic">暂无条目</div>
          )}
          {worldCards.map((card) => (
            <div
              key={card.name}
              onClick={() => setEditing(card)}
              className={`p-4 rounded-lg border cursor-pointer transition-all shadow-sm ${editing?.name === card.name
                  ? 'bg-primary text-white border-primary shadow-md'
                  : 'bg-surface border-border text-ink-500 hover:border-primary/50 hover:text-ink-900 hover:shadow-md'
                }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold font-serif text-lg">{card.name}</span>
                <Globe size={14} className="opacity-70" />
              </div>
              <div className="text-xs opacity-90 flex items-center gap-2">
                <span className={`uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded ${editing?.name === card.name ? 'bg-white/20' : 'bg-gray-100 text-ink-600'}`}>
                  {card.category}
                </span>
              </div>
              <div className={`text-xs mt-2 line-clamp-2 font-serif leading-relaxed ${editing?.name === card.name ? 'opacity-90' : 'opacity-70'}`}>
                {card.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Editor */}
      <Card className="lg:col-span-8 bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-paper">
        {editing ? (
          <div className="flex-1 flex flex-col">
            <div className="flex flex-row items-center justify-between p-6 border-b border-border bg-gray-50/50">
              <h3 className="font-bold text-lg text-ink-900 flex items-center gap-2">
                <Box className="text-primary" size={18} />
                {editing.name ? `编辑: ${editing.name}` : '新建世界条目'}
              </h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  <X size={16} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <form id="world-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-ink-500 uppercase">名称</label>
                    <Input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="例如: 铁城"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-ink-500 uppercase">类别</label>
                    <Input
                      type="text"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      placeholder="例如: 地点, 势力, 法则"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-ink-900 focus:outline-none focus:border-primary transition-colors min-h-[100px] placeholder:text-ink-400 font-serif"
                    placeholder="详细描述..."
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">规则/属性 (逗号分隔)</label>
                  <Input
                    type="text"
                    value={Array.isArray(formData.rules) ? formData.rules.join(', ') : ''}
                    onChange={(e) => setFormData({ ...formData, rules: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="例如: 低重力, 高犯罪率"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="immutable"
                    checked={formData.immutable}
                    onChange={(e) => setFormData({ ...formData, immutable: e.target.checked })}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <label htmlFor="immutable" className="text-sm text-ink-600 font-medium cursor-pointer">不可变 (核心设定)</label>
                </div>
              </form>
            </div>
            <div className="p-4 border-t border-border bg-gray-50 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
              <Button form="world-form" type="submit">
                <Save size={16} className="mr-2" /> 保存条目
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-ink-400 opacity-60">
            <Globe size={48} className="mb-4 text-ink-300" />
            <div className="font-serif text-lg">选择或创建世界条目</div>
          </div>
        )}
      </Card>
    </div>
  );
}
