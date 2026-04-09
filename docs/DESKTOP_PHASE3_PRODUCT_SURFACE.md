# Desktop Phase 3 Product Surface

This document records the desktop-shell product capabilities added in phase 3.

## Scope

Phase 3 focuses on the platform surface of the Electron shell rather than business feature rewrites:

- Native application menu
- System tray and background-running behavior
- `wenshape://` deep-link protocol bridge
- Native file and directory dialogs for desktop runtime operations

## Delivered Capabilities

### 1. Native Menu

The desktop shell now installs an application menu with:

- File menu
- Edit menu
- View menu
- Window menu
- Help menu
- Development menu in dev builds only

The file menu exposes desktop-specific actions such as:

- Import text file
- Choose export path
- Open logs directory
- Open data directory
- Open runtime directory

### 2. Tray And Background Runtime

The shell now creates a tray icon and keeps WenShape running in the background.

Behavior:

- Closing the window hides it to the tray instead of shutting down the runtime
- Minimizing the window also hides it to the tray
- Explicit quit actions show an exit confirmation before shutdown
- Tray menu can restore the window or open runtime folders

### 3. Deep Link Bridge

The shell now registers the `wenshape://` protocol and forwards deep-link payloads to the renderer.

Current route support:

- `wenshape://project/<projectId>/session`
- `wenshape://open?path=/project/<projectId>/session`

This is the shell-level prerequisite for later phases such as:

- Account login callbacks
- Payment return callbacks
- Cloud content handoff

### 4. Native Dialog Bridge

The preload bridge now exposes controlled desktop APIs for:

- Opening logs, data, runtime directories
- Revealing the main log file
- Picking a text file from disk
- Choosing an export destination path

The renderer currently uses these capabilities in two ways:

- Desktop settings section in the title-bar menu
- Global desktop command listeners for menu-driven import/export actions

## Engineering Notes

- Desktop APIs remain behind the preload bridge
- Renderer still has no direct Node.js access
- Menu, tray, protocol, and dialog logic are separated into dedicated modules to keep the main entry maintainable

## Phase Boundary

Phase 3 still does not include:

- Auto-update rollout
- Signing/notarization
- Official installer delivery
- Account or payment integration

Those remain phase 4 and phase 5 work.
