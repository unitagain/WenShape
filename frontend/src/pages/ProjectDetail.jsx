import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR, { mutate } from 'swr';
import { useNavigate, useParams } from 'react-router-dom';
import { projectsAPI, cardsAPI } from '../api';
import { DashboardView } from '../components/project/DashboardView';
import { CharacterView } from '../components/project/CharacterView';
import { DraftsView } from '../components/project/DraftsView';

import FanfictionView from './FanfictionView';
import { WorldView } from '../components/project/WorldView';
import { StyleView } from '../components/project/StyleView';
import { Button } from '../components/ui/Button';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  PenTool,
  Globe,
  FileText,
  ArrowLeft,
  Library
} from 'lucide-react';
import { cn } from '../lib/utils';

const fetcher = (fn) => fn().then(res => res.data);

function ProjectDetail() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');

  const { data: project } = useSWR(
    projectId ? `project-${projectId}` : null,
    () => fetcher(() => projectsAPI.get(projectId)),
    { revalidateOnFocus: false }
  );

  const tabLabels = {
    dashboard: '仪表盘',
    writing: '写作会话',
    fanfiction: '同人创作',
    characters: '角色',
    world: '世界观',
    style: '文风设定',
    drafts: '档案库'
  };

  // Data States
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboard, setDashboard] = useState(null);

  const [characters, setCharacters] = useState([]);
  const [editingCharacter, setEditingCharacter] = useState(null);

  useEffect(() => {
    if (activeTab === 'dashboard') loadDashboard();
    if (activeTab === 'characters') loadCharacters();
  }, [projectId, activeTab]);

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try {
      const response = await projectsAPI.getDashboard(projectId);
      setDashboard(response.data);
    } catch (error) {
      setDashboardError(error.message);
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadCharacters = async () => {
    try {
      const names = await cardsAPI.listCharacters(projectId);
      const chars = [];
      for (const name of names.data) {
        const char = await cardsAPI.getCharacter(projectId, name);
        chars.push(char.data);
      }
      setCharacters(chars);
    } catch (error) {
      console.error('Failed to load characters:', error);
    }
  };

  const saveCharacter = async (character) => {
    try {
      if (editingCharacter?.name && editingCharacter.name !== '') {
        await cardsAPI.updateCharacter(projectId, editingCharacter.name, character);
      } else {
        await cardsAPI.createCharacter(projectId, character);
      }
      await loadCharacters();
      setEditingCharacter(null);
    } catch (error) {
      alert(`保存失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar Navigation */}
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="w-64 border-r border-border bg-surface flex flex-col shadow-sm"
      >
        <div className="p-4 border-b border-border">
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              variant="ghost"
              onClick={() => navigate('/')}
              className="w-full justify-start text-sm"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回作品列表
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="mt-4 text-xl font-serif font-bold text-ink-900 truncate">
              {project?.name || '加载中...'}
            </h2>
          </motion.div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavButton
            active={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
            icon={<LayoutDashboard size={18} />}
            label={tabLabels.dashboard}
          />
          <NavButton
            active={activeTab === 'writing'}
            onClick={() => navigate(`/project/${projectId}/session`)}
            icon={<PenTool size={18} />}
            label={tabLabels.writing}
            highlight
          />
          <NavButton
            active={activeTab === 'fanfiction'}
            onClick={() => setActiveTab('fanfiction')}
            icon={<BookOpen size={18} />}
            label={tabLabels.fanfiction}
          />
          <NavButton
            active={activeTab === 'characters'}
            onClick={() => setActiveTab('characters')}
            icon={<Users size={18} />}
            label={tabLabels.characters}
          />
          <NavButton
            active={activeTab === 'world'}
            onClick={() => setActiveTab('world')}
            icon={<Globe size={18} />}
            label={tabLabels.world}
          />
          <NavButton
            active={activeTab === 'style'}
            onClick={() => setActiveTab('style')}
            icon={<FileText size={18} />}
            label={tabLabels.style}
          />
          <NavButton
            active={activeTab === 'drafts'}
            onClick={() => setActiveTab('drafts')}
            icon={<Library size={18} />}
            label={tabLabels.drafts}
          />
        </nav>
      </motion.div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="h-full"
          >
            {activeTab === 'dashboard' && (
              <DashboardView
                dashboard={dashboard}
                loading={dashboardLoading}
                error={dashboardError}
                onRefresh={loadDashboard}
              />
            )}

            {activeTab === 'fanfiction' && (
              <FanfictionView />
            )}
            {activeTab === 'characters' && (
              <CharacterView
                characters={characters}
                onSave={saveCharacter}
                onEdit={setEditingCharacter}
                editingCharacter={editingCharacter}
              />
            )}
            {activeTab === 'world' && (
              <WorldView projectId={projectId} />
            )}
            {activeTab === 'style' && (
              <StyleView projectId={projectId} />
            )}
            {activeTab === 'drafts' && (
              <DraftsView projectId={projectId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// Optimized Nav Button with animations
function NavButton({ active, onClick, icon, label, highlight }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02, x: 4 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
        active
          ? "bg-primary text-white shadow-sm"
          : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
        highlight && !active && "text-accent-active hover:text-accent-active"
      )}
    >
      <span className={active ? "text-white" : "text-ink-400"}>
        {icon}
      </span>
      {label}
      {highlight && !active && (
        <motion.span
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="ml-auto h-2 w-2 rounded-full bg-accent-active"
        />
      )}
    </motion.button>
  );
}

export default ProjectDetail;
