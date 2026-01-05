import { Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import WritingSession from './pages/WritingSession';
import FanfictionView from './pages/FanfictionView';
import Agents from './pages/Agents';
import System from './pages/System';
import LLMSetupModal from './components/LLMSetupModal';
import { configAPI } from './api';

import { Layout } from './components/Layout'; // Use the new Layout

function App() {
  const [currentProject, setCurrentProject] = useState(null);
  const navigate = useNavigate();
  const [llmStatus, setLlmStatus] = useState(null);
  const [showLLMSetup, setShowLLMSetup] = useState(false);

  const selectProject = (project) => {
    setCurrentProject(project);
    navigate(`/project/${project.id}`);
  };

  const refreshLLMStatus = async () => {
    try {
      const resp = await configAPI.getLLM();
      setLlmStatus(resp.data);
      return resp.data;
    } catch (e) {
      console.warn("Failed to fetch LLM status", e);
      return null;
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const status = await refreshLLMStatus();
        if (!status) return;

        const configuredMap = status?.configured || {};
        const providersMeta = status?.providers || [];
        const requiresKey = (p) => !!providersMeta.find(x => x.id === p)?.requires_key;

        const agentProviders = status?.agent_providers || {};
        const effective = Object.values(agentProviders);
        const unique = Array.from(new Set(effective.filter(Boolean)));

        const missing = unique.filter((p) => requiresKey(p) && !configuredMap?.[p]);
        if (missing.length) setShowLLMSetup(true);
      } catch {
        // Backend might not be running yet
      }
    })();
  }, []);

  return (
    <Layout onOpenSettings={() => setShowLLMSetup(true)}>
      <Routes>
        <Route path="/" element={<ProjectList onSelectProject={selectProject} />} />
        <Route path="/project/:projectId" element={<ProjectDetail />} />
        <Route path="/project/:projectId/session" element={<WritingSession />} />
        <Route path="/project/:projectId/fanfiction" element={<FanfictionView />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/system" element={<System />} />
      </Routes>

      <LLMSetupModal
        open={showLLMSetup}
        status={llmStatus}
        onClose={async () => {
          setShowLLMSetup(false);
          try {
            await refreshLLMStatus();
          } catch {
            // ignore
          }
        }}
        onSave={async (payload) => {
          await configAPI.updateLLM(payload);
          await refreshLLMStatus();
        }}
      />
    </Layout>
  );
}

export default App;
