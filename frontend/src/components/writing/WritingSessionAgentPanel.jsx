import AgentsPanel from '../ide/panels/AgentsPanel';
import AgentStatusPanel from '../ide/AgentStatusPanel';

export default function WritingSessionAgentPanel({ vm }) {
  const {
    traceEvents,
    agentTraces,
    agentMode,
    setAgentMode,
    canUseWriter,
    agentBusy,
    aiLockedChapter,
    activeChapterKey,
    t,
    isCancelling,
    handleCancel,
    selectionInfo,
    attachedSelection,
    setAttachedSelection,
    setEditScope,
    editScope,
    contextDebug,
    progressEvents,
    messages,
    memoryPackStatus,
    chapterInfo,
    editContextMode,
    setEditContextMode,
    diffReview,
    agentChapterKey,
    diffDecisions,
    handleAcceptAllDiff,
    handleRejectAllDiff,
    handleApplySelectedDiff,
    addMessage,
    handleStart,
    handleSubmitFeedback,
    countWords,
    writingLanguage,
    dialogMaxChars,
  } = vm;

  return (
    <AgentsPanel traceEvents={traceEvents} agentTraces={agentTraces}>
      <AgentStatusPanel
        mode={agentMode}
        onModeChange={setAgentMode}
        createDisabled={!canUseWriter}
        editDisabled={canUseWriter}
        inputDisabled={agentBusy && String(aiLockedChapter || '') !== activeChapterKey}
        inputDisabledReason={
          agentBusy && String(aiLockedChapter || '') !== activeChapterKey
            ? t('writingSession.aiLockedHint').replace('{n}', String(aiLockedChapter))
            : ''
        }
        isGenerating={agentBusy && String(aiLockedChapter || '') === activeChapterKey}
        isCancelling={isCancelling}
        onCancel={handleCancel}
        selectionCandidateSummary={
          agentMode === 'edit' && selectionInfo?.text?.trim()
            ? t('writingSession.selectionPending').replace('{n}', countWords(selectionInfo.text, writingLanguage))
            : ''
        }
        selectionAttachedSummary={
          agentMode === 'edit' && attachedSelection?.text?.trim()
            ? t('writingSession.selectionAdded').replace('{n}', countWords(attachedSelection.text, writingLanguage))
            : ''
        }
        selectionCandidateDifferent={
          Boolean(selectionInfo?.text?.trim()) &&
          Boolean(attachedSelection?.text?.trim()) &&
          (selectionInfo.start !== attachedSelection.start ||
            selectionInfo.end !== attachedSelection.end ||
            selectionInfo.text !== attachedSelection.text)
        }
        onAttachSelection={() => {
          if (!selectionInfo?.text?.trim()) return;
          setAttachedSelection({
            start: selectionInfo.start,
            end: selectionInfo.end,
            text: selectionInfo.text,
          });
          setEditScope('selection');
        }}
        onClearAttachedSelection={() => {
          setAttachedSelection(null);
          setEditScope('document');
        }}
        editScope={editScope}
        onEditScopeChange={setEditScope}
        contextDebug={contextDebug}
        progressEvents={progressEvents}
        messages={messages}
        memoryPackStatus={memoryPackStatus}
        activeChapter={agentBusy ? aiLockedChapter : chapterInfo.chapter}
        editContextMode={editContextMode}
        onEditContextModeChange={setEditContextMode}
        diffReview={diffReview && String(diffReview?.chapterKey || '') === agentChapterKey ? diffReview : null}
        diffDecisions={diffDecisions}
        onAcceptAllDiff={handleAcceptAllDiff}
        onRejectAllDiff={handleRejectAllDiff}
        onApplySelectedDiff={handleApplySelectedDiff}
        onSubmit={(text) => {
          if (!chapterInfo.chapter) {
            addMessage('system', t('writingSession.pleaseSelectChapter'));
            return;
          }

          if (agentMode === 'create') {
            if (!canUseWriter) {
              addMessage('system', t('writingSession.chapterNotWritable'));
              setAgentMode('edit');
              return;
            }
            addMessage('user', text);
            handleStart(chapterInfo.chapter, 'deep', text);
            return;
          }

          handleSubmitFeedback(text);
        }}
        inputMaxLength={dialogMaxChars}
      />
    </AgentsPanel>
  );
}
