import React, { createContext, useContext, useReducer, useMemo } from 'react';

const IDEContext = createContext(null);

const initialState = {
    // Panel Control
    activeActivity: 'explorer',      // 'explorer' | 'cards' | 'search' | 'settings' | 'drafts'
    sidePanelVisible: true,
    rightPanelVisible: true,
    sidePanelWidth: 300,
    rightPanelWidth: 350,

    // Editor State
    activeProjectId: null,
    activeChapter: null,
    activeDocument: null, // { type: 'chapter' | 'card' | 'wiki', id: string, data: any }

    // 新增: 编辑器状态
    cursorPosition: { line: 1, column: 1 },
    wordCount: 0,
    lastSavedAt: null,
    unsavedChanges: false,

    // 新增: 连接状态
    connectionStatus: 'connected', // 'connected' | 'disconnected' | 'syncing'

    // UI State
    theme: 'light', // 'light' | 'dark'
    zenMode: false,

    // Dialog State
    createChapterDialogOpen: false,
};

function ideReducer(state, action) {
    switch (action.type) {
        case 'SET_ACTIVE_PANEL':
            // If clicking the same panel, toggle visibility
            if (state.activeActivity === action.payload) {
                return { ...state, sidePanelVisible: !state.sidePanelVisible };
            }
            return { ...state, activeActivity: action.payload, sidePanelVisible: true };

        case 'TOGGLE_LEFT_PANEL':
            return { ...state, sidePanelVisible: !state.sidePanelVisible };

        case 'TOGGLE_RIGHT_PANEL':
            return { ...state, rightPanelVisible: !state.rightPanelVisible };

        case 'SET_PANEL_WIDTH':
            return { ...state, [action.panel === 'left' ? 'sidePanelWidth' : 'rightPanelWidth']: action.width };

        case 'SET_ACTIVE_DOCUMENT':
            return { ...state, activeDocument: action.payload };

        case 'SET_PROJECT_ID':
            return { ...state, activeProjectId: action.payload };

        case 'SET_CURSOR_POSITION':
            return { ...state, cursorPosition: action.payload };

        case 'SET_WORD_COUNT':
            return { ...state, wordCount: action.payload };

        case 'SET_SAVED':
            return { ...state, lastSavedAt: new Date(), unsavedChanges: false };

        case 'SET_UNSAVED':
            return { ...state, unsavedChanges: true };

        case 'SET_CONNECTION_STATUS':
            return { ...state, connectionStatus: action.payload };

        case 'OPEN_CREATE_CHAPTER_DIALOG':
            return { ...state, createChapterDialogOpen: true };

        case 'CLOSE_CREATE_CHAPTER_DIALOG':
            return { ...state, createChapterDialogOpen: false };

        case 'TOGGLE_ZEN_MODE':
            return {
                ...state,
                zenMode: !state.zenMode,
                sidePanelVisible: state.zenMode, // Exit zen -> restore (simplified)
                rightPanelVisible: state.zenMode
            };

        default:
            return state;
    }
}

export function IDEProvider({ children, projectId }) {
    const [state, dispatch] = useReducer(ideReducer, {
        ...initialState,
        activeProjectId: projectId,
    });

    const value = useMemo(() => ({ state, dispatch }), [state]);

    return (
        <IDEContext.Provider value={value}>
            {children}
        </IDEContext.Provider>
    );
}

export function useIDE() {
    const context = useContext(IDEContext);
    if (!context) throw new Error('useIDE must be used within IDEProvider');
    return context;
}
