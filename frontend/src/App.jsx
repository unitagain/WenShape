import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import ErrorBoundary from './components/ErrorBoundary';
import { projectsAPI } from './api';
import { t } from './i18n';
import logger from './utils/logger';

const WritingSession = lazy(() => import('./pages/WritingSession'));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--vscode-bg)] text-[var(--vscode-fg)]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[var(--vscode-focus-border)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[var(--vscode-fg-subtle)] text-sm">{t('app.loading')}</p>
      </div>
    </div>
  );
}

function AutoRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const redirect = async () => {
      try {
        const res = await projectsAPI.list();
        const projects = res.data;

        if (projects && projects.length > 0) {
          navigate(`/project/${projects[0].id}/session`, { replace: true });
          return;
        }

        const newProject = await projectsAPI.create({ name: t('app.defaultProjectName') });
        navigate(`/project/${newProject.data.id}/session`, { replace: true });
      } catch (err) {
        logger.error('Failed to load projects:', err);
        setError(err?.message || String(err));
      }
    };

    redirect();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--vscode-bg)] text-[var(--vscode-fg)]">
        <div className="ws-paper p-8 text-center max-w-md">
          <h1 className="text-lg font-bold text-red-600 mb-2">{t('app.loadFailed')}</h1>
          <p className="text-[var(--vscode-fg-subtle)] text-sm break-words">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 h-10 bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] rounded-[6px] border border-[var(--vscode-input-border)] hover:opacity-90 transition-colors"
          >
            {t('app.retryBtn')}
          </button>
        </div>
      </div>
    );
  }

  return <LoadingScreen />;
}

function RedirectToSession() {
  return <Navigate to="session" replace />;
}

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<AutoRedirect />} />
          <Route path="/project/:projectId/session" element={<WritingSession />} />

          <Route path="/project/:projectId" element={<RedirectToSession />} />
          <Route path="/project/:projectId/fanfiction" element={<RedirectToSession />} />

          <Route path="/agents" element={<Navigate to="/" replace />} />
          <Route path="/system" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
