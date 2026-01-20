import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR, { mutate } from 'swr';
import { projectsAPI } from '../api';
import { Button, Input, Card } from '../components/ui/core';
import { Plus, Book, Clock, ChevronRight, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const fetcher = (fn) => fn().then(res => res.data);

const ProjectCardSkeleton = () => (
  <div className="bg-surface border border-border rounded-lg p-6 animate-pulse">
    <div className="h-6 w-3/4 bg-ink-100 rounded mb-2" />
    <div className="h-4 w-full bg-ink-50 rounded mb-2" />
    <div className="h-4 w-2/3 bg-ink-50 rounded mb-6" />
    <div className="h-3 w-1/3 bg-ink-100 rounded" />
  </div>
);

function ProjectList({ onSelectProject }) {
  const navigate = useNavigate();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(false);

  const { data: projects = [], isLoading } = useSWR(
    'projects-list',
    () => fetcher(projectsAPI.list),
    { revalidateOnFocus: false }
  );

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await projectsAPI.create(newProject);
      mutate('projects-list');
      setShowCreateForm(false);
      setNewProject({ name: '', description: '' });
      if (onSelectProject) {
        onSelectProject(response.data);
      } else {
        navigate(`/project/${response.data.id}`);
      }
    } catch (error) {
      alert('Failed: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full p-8 max-w-5xl mx-auto flex flex-col gap-10">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-end pb-4 border-b border-border"
      >
        <div>
          <h2 className="text-3xl font-serif font-bold text-ink-900 tracking-tight">我的作品</h2>
          <p className="text-ink-500 mt-2 text-sm">选择一部小说继续创作，或开启新的篇章。</p>
        </div>
        <div className="flex gap-2">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button variant="ghost" onClick={() => mutate('projects-list')} disabled={isLoading}>
              <RotateCcw size={16} className={isLoading ? 'animate-spin mr-2' : 'mr-2'} />
              刷新
            </Button>
          </motion.div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus size={16} className="mr-2" />
              新建作品
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Create Form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: '1.5rem' }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="bg-surface">
              <div className="p-6">
                <h3 className="text-lg font-medium text-ink-900 mb-4 flex items-center">
                  <Book size={18} className="mr-2 text-ink-500" /> 初始化新书
                </h3>
                <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-1"
                  >
                    <label className="text-xs font-medium text-ink-500 uppercase">书名</label>
                    <Input
                      type="text"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="例如: 此时此刻"
                      required
                      className="bg-background"
                    />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 }}
                    className="space-y-1"
                  >
                    <label className="text-xs font-medium text-ink-500 uppercase">简介</label>
                    <textarea
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      className="flex min-h-[80px] w-full rounded-md border-b border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-ink-400 focus-visible:outline-none focus-visible:border-ink-900 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                      placeholder="简要描述..."
                    />
                  </motion.div>
                  <div className="flex space-x-3 pt-2">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button type="submit" disabled={loading}>
                        创建
                      </Button>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowCreateForm(false)}
                      >
                        取消
                      </Button>
                    </motion.div>
                  </div>
                </form>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Skeleton Loading */}
        {isLoading && (
          <>
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </>
        )}

        {/* Empty State */}
        {!isLoading && projects.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="col-span-full flex flex-col items-center justify-center py-24 border border-dashed border-border rounded-lg bg-surface/50"
          >
            <Book className="h-12 w-12 text-ink-400 mb-4 opacity-50" />
            <p className="text-ink-500">暂无作品</p>
            <Button variant="link" onClick={() => setShowCreateForm(true)} className="mt-2 text-ink-900">
              开始创作
            </Button>
          </motion.div>
        )}

        {/* Project Cards */}
        <AnimatePresence>
          {!isLoading && projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
              whileHover={{ y: -4 }}
            >
              <Card
                onClick={() => onSelectProject ? onSelectProject(project) : navigate(`/project/${project.id}`)}
                className="group cursor-pointer hover:shadow-paper-hover transition-all duration-300 bg-surface border-border/50 hover:border-primary/30 h-full"
              >
                <div className="p-6 h-full flex flex-col relative">
                  <h3 className="text-xl font-serif font-bold text-ink-900 mb-2 group-hover:text-primary transition-colors pr-6">
                    {project.name}
                  </h3>
                  <p className="text-sm text-ink-500 mb-6 line-clamp-2 flex-1">
                    {project.description || '暂无简介'}
                  </p>
                  <div className="flex items-center text-xs text-ink-400 mt-auto pt-4 border-t border-border/30">
                    <Clock size={12} className="mr-2" />
                    {new Date(project.created_at).toLocaleDateString('zh-CN')}
                  </div>

                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    whileHover={{ opacity: 1, x: 0 }}
                    className="absolute top-6 right-6"
                  >
                    <ChevronRight className="text-ink-400 h-5 w-5" />
                  </motion.div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default ProjectList;
