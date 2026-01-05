import React, { useState } from 'react';
import { Card, Button, Input } from '../ui/core';
import { Plus, User, X, Save } from 'lucide-react';

export function CharacterView({ characters, onEdit, onSave, editing, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    identity: '',
    appearance: '',
    motivation: '',
    personality: [],
    speech_pattern: '',
    relationships: [],
    boundaries: [],
    arc: ''
  });

  React.useEffect(() => {
    if (editing) {
      setFormData(editing);
    } else {
      // Reset form when not editing
      setFormData({
        name: '',
        identity: '',
        appearance: '',
        motivation: '',
        personality: [],
        speech_pattern: '',
        relationships: [],
        boundaries: [],
        arc: ''
      });
    }
  }, [editing]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...formData,
      identity: (formData.identity || '').trim() || '未填写',
      motivation: (formData.motivation || '').trim() || '未填写',
    };
    onSave(payload);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Left List */}
      <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-ink-900">角色列表</h3>
          <Button size="sm" onClick={() => onEdit({})}>
            <Plus size={16} className="mr-2" /> 新建
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {characters.map((char) => (
            <div
              key={char.name}
              onClick={() => onEdit(char)}
              className={`p-4 rounded-lg border cursor-pointer transition-all shadow-sm ${editing?.name === char.name
                ? 'bg-primary text-white border-primary shadow-md'
                : 'bg-surface border-border text-ink-500 hover:border-primary/50 hover:text-ink-900 hover:shadow-md'
                }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold font-serif text-lg">{char.name}</span>
                <User size={14} className="opacity-70" />
              </div>
              <div className={`text-xs opacity-90 line-clamp-2 ${editing?.name === char.name ? 'text-white' : 'text-ink-400'}`}>
                {char.identity}
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
                <User className="text-primary" size={18} />
                {editing.name ? `编辑: ${editing.name}` : '新建角色'}
              </h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  <X size={16} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              <form id="char-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-ink-500 uppercase">名称</label>
                    <Input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="角色姓名"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-ink-500 uppercase">身份</label>
                    <Input
                      type="text"
                      value={formData.identity}
                      onChange={(e) => setFormData({ ...formData, identity: e.target.value })}
                      placeholder="例如：流浪剑客"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">外貌特征</label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-ink-400 focus-visible:outline-none focus-visible:border-ink-900 transition-colors"
                    value={formData.appearance || ''}
                    onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                    placeholder="例如：银色长发，琥珀色眼睛，身穿蓝白相间的冒险者服装..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">核心动机</label>
                  <Input
                    type="text"
                    value={formData.motivation}
                    onChange={(e) => setFormData({ ...formData, motivation: e.target.value })}
                    placeholder="例如：寻找失散的亲人"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">性格特征 (逗号分隔)</label>
                  <Input
                    type="text"
                    value={Array.isArray(formData.personality) ? formData.personality.join(', ') : ''}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value.split(',').map(s => s.trim()) })}
                    placeholder="例如：勇敢, 鲁莽, 忠诚"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-ink-500 uppercase">角色弧光 (Arc)</label>
                  <textarea
                    className="flex min-h-[100px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-ink-400 focus-visible:outline-none focus-visible:border-ink-900 transition-colors"
                    value={formData.arc}
                    onChange={(e) => setFormData({ ...formData, arc: e.target.value })}
                    placeholder="描述角色的成长路径..."
                  />
                </div>

              </form>
            </div>
            <div className="p-4 border-t border-border bg-gray-50 flex justify-end gap-3">
              <Button variant="ghost" onClick={onCancel}>取消</Button>
              <Button form="char-form" type="submit">
                <Save size={16} className="mr-2" /> 保存角色
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-ink-400">
            <User size={64} className="mb-4 opacity-20" />
            <div className="font-serif text-lg">选择或创建角色以开始编辑</div>
          </div>
        )}
      </Card>
    </div>
  );
}
