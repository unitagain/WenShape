import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import WritingSession from './pages/WritingSession';
import FanfictionView from './pages/FanfictionView';
import Agents from './pages/Agents';
import System from './pages/System';
import ErrorBoundary from './components/ErrorBoundary';
import { Layout } from './components/Layout';

function App() {
  const [currentProject, setCurrentProject] = useState(null);

  const navigate = useNavigate();

  const selectProject = (project) => {
    setCurrentProject(project);
    navigate(`/project/${project.id}`);
  };

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/project/:projectId/session" element={<WritingSession />} />
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectList onSelectProject={selectProject} />} />
          <Route path="/project/:projectId" element={<ProjectDetail />} />
          <Route path="/project/:projectId/fanfiction" element={<FanfictionView />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/system" element={<System />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
