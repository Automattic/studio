# New Project Creation Flow

## Vision

Studio builds things **powered by WordPress**. Not just sites — anything. A blog, an online store, a social network, a mobile app, a game, a newspaper, a community hub, an API. WordPress is the foundation: data, auth, APIs, media, admin. The frontend can be anything.

Today Studio builds WordPress block themes. But the architecture supports headless builds too — WordPress as the backend with React, Vue, or whatever serves the frontend. The creation flow is the same either way. The agent just uses different tools depending on the stack.

## v1 Scope

**Fully working:** WordPress block theme path — spec → design → build → done.

**Functional but basic:** Headless path — spec → design → `site_create` with default theme → enable REST API → scaffold connected starter app. Polished headless frontend building is future work.

**Existing and unchanged:** Import from Jetpack Backup, WordPress Export (.xml), and WordPress.com sync. These flows use the current `AddSiteModal` module.

**New but stubbed:** "Import anything" via URL — paste any website URL and the agent scrapes design/content to recreate it locally. v1 can fake this with a placeholder flow that captures the URL and creates a basic site inspired by it.

## Implementation Status

### Done

- **Add-site window removed.** Dedicated Electron window (`add-site-window.ts`, `add-site-root.tsx`) deleted. IPC handlers, preload bridge, renderer routing, and `isAddSiteVisible` menu state all cleaned up.
- **Creation flow in main window.** `CreateProjectFlow` renders in the primary panel with DotGrid background. "Something new" and "Bring something you already have" chooser cards with frosted glass styling. Triggered via sidebar button, Cmd+N menu, `create-project` IPC event, or auto-start for new users.
- **Placeholder task system.** "Something new" creates a task with `SETUP_SITE_ID` (`__project-setup__`) — no site on disk. Task list shows setup tasks ungrouped (no site header). When the agent calls `site_create`, the `createSite` handler automatically migrates setup tasks to the real site.
- **First-time user experience.** Auto-starts creation flow when there are no sites AND no tasks. Sidebar and browser panel collapse for distraction-free full-width experience.
- **Questionnaire system.** Separate IPC channel (`ai:question-request` / `ai:question-response`) independent from permissions. Full round-trip: CLI headless → agent-manager → IPC event → Redux `pendingQuestions` → `TaskQuestionPrompt` UI → response back to CLI. Options render as a vertical text list with hover-to-theme styling. Chat input doubles as free-form answer when a question is pending.
- **Browser preview infrastructure.** Preview server (`src/lib/preview-server.ts`) serves local HTML files via `http://localhost:<port>` to satisfy CSP. Agent-manager converts file paths to localhost URLs. Browser panel accepts preview tabs without a running site (`hasContent` flag). Panel auto-expands when preview content arrives. `browser_navigate` tool description updated to mention local file paths.
- **Task chat max-width.** Messages and input capped at `max-w-3xl` (768px).
- **Site-spec skill rewritten.** Conversational, not a form. Leads with "read what the user already told you" — only asks about what's missing. Design preview phase is mandatory with explicit `browser_navigate` instructions.
- **Sidebar layout.** Tasks section scrolls when long; projects section stays visible at bottom. "Add project" button shows active state when creation mode is on.
- **Floating tour component.** Built (`src/components/new-ui/floating-tour.tsx`) with step-by-step tooltips, arrow positioning, dismiss persistence. Not yet integrated into the post-creation transition.
- **Import step UI.** Shows WordPress.com, Pressable, Jetpack Backup, WordPress Export, and URL options. Handlers are stubbed (TODO).
- **Orphan task cleanup.** Task list filters out tasks whose site no longer exists.

### Not yet done

- **Import flow wiring.** The import options render but `handleSelect` is a TODO. Needs to connect to existing `AddSiteModal` flows for backup/xml/wpcom, and build the URL import agent flow.
- **Floating tour integration.** Component exists but is never triggered. Needs to fire after the user commits to a design and the build starts — point to the build task and project detail.
- **Post-creation transition.** Sidebar should auto-expand when the build starts. User should land on Project Detail view. "Your project is ready!" moment when build completes. None of this is wired.
- **Headless path.** Stack choice exists in the skill but no build logic. Needs: React/Vue scaffold tools, REST API enablement, frontend starter project generation.
- **Design iteration UX.** No structured "commit" moment — the agent just waits for text. Could benefit from a clear "Ready to build?" UI element.
- **Preview storage cleanup.** Files in `~/Studio/previews/` persist but are never cleaned up when a project is deleted.

## Flow

The creation flow is the user's **first Task**. It runs in the main window using the existing Task system — primary panel for the spec and chat, browser panel for design previews. When creation is done, the task persists in the sidebar like any other task.

```
Welcome / Auth (existing, unchanged)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│            WHAT DO YOU WANT TO BUILD?                     │
│            (sidebar hidden, full-width, dot grid bg)     │
│                                                          │
│   ┌──────────────────┐    ┌──────────────────────┐      │
│   │   Something      │    │   Bring something    │      │
│   │   new            │    │   you already have   │      │
│   │                  │    │                      │      │
│   │  A blog, a game, │    │  From WordPress.com, │      │
│   │  an app, a       │    │  a backup, a URL,    │      │
│   │  store, a social │    │  or anywhere else.   │      │
│   │  network —       │    │                      │      │
│   │  anything.       │    │                      │      │
│   └────────┬─────────┘    └──────────┬───────────┘      │
└────────────┼─────────────────────────┼───────────────────┘
             │                         │
             ▼                         ▼
┌───────────────────────┐ ┌──────────────────────────────┐
│  PROJECT SPEC (chat)  │ │      WHERE IS IT?            │
│                       │ │                              │
│  Agent reads the      │ │  ○ WordPress.com             │
│  user's initial       │ │  ○ Pressable                 │
│  message and only     │ │  ○ Jetpack Backup            │
│  asks about what's    │ │  ○ WordPress Export (.xml)   │
│  genuinely missing.   │ │  ○ URL                       │
│                       │ │    Paste any website and     │
│  (see site-spec       │ │    we'll pull it in          │
│   skill)              │ └──────────┬───────────────────┘
│                       │            │
│                       │            ▼
│                       │ ┌──────────────────────────────┐
│                       │ │  IMPORT (chat)               │
│                       │ │  Existing imports: standard   │
│                       │ │  modal flow (backup, xml,    │
│                       │ │  wpcom sync).                │
│                       │ │  URL import: agent scrapes   │
│                       │ │  and recreates (stubbed v1). │
│                       │ └──────────────────────────────┘
└───────────┬───────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│          DESIGN OPTIONS (chat + browser panel)           │
│                                                          │
│  Agent generates 2-3 polished design directions          │
│  as HTML/CSS/JS, rendered in the browser panel via       │
│  preview server (http://localhost:<port>).                │
│                                                          │
│  Files stored in ~/Studio/previews/.                     │
│  Each option is a standalone .html file. An index.html   │
│  ties them together for side-by-side comparison.         │
│  Agent calls browser_navigate with the absolute file     │
│  path to show previews in the browser panel.             │
│                                                          │
│  User picks / iterates / rejects via chat                │
│  User commits: "Let's go with this one"                  │
└─────────────────────────┼────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    BUILD                                  │
│                                                          │
│  Agent calls site_create → task migrated from            │
│  __project-setup__ to real site automatically.           │
│  Block theme → wp_cli → validate → screenshot            │
│                                                          │
│  TODO: Sidebar expansion, floating tour, Project         │
│  Detail holding pattern.                                 │
│                                                          │
│  "Your project is ready!"                                │
└─────────────────────────────────────────────────────────┘
```

## First-Time User Experience

New users see the Welcome and Permissions screens (existing, unchanged — handles WP.com auth). After that:

1. **Creation flow auto-starts.** The "What do you want to build?" screen fills the main window with a dot grid background. Sidebar and browser panel are hidden — no distractions. Triggers when there are no sites AND no tasks.
2. **Spec and design happen in the primary + browser panels.** The user's first interaction with Studio is a conversation. They don't need to learn the app's full UI yet. The user's initial description appears as the first chat message.
3. **After committing to a design,** the sidebar expands for the first time. A floating tour component (built, not yet integrated) points to key elements:
   - The build task in the sidebar ("Studio is building your site")
   - The Project Detail view ("Check out what your project can do")
4. **Project Detail is the holding pattern.** While the agent builds the theme (5+ minutes), the user explores publishing to WordPress.com/Pressable, sync, and preview links. This is productive wait time. (TODO: not yet wired)
5. **Build completes.** The task updates, the browser panel shows the real site. The user can start a new task to iterate.

Returning users with existing projects skip straight to the main app. The "+ Add project" button in the sidebar triggers the same creation flow, but with the sidebar visible.

## Project Spec Skill

The `site-spec` skill (`apps/cli/ai/plugin/skills/site-spec/SKILL.md`) gathers everything the agent needs before designing. It's a conversation, not a form.

**Key principle:** The agent reads the user's initial message first and extracts everything it can — name, purpose, audience, tone, references. It only asks about what's genuinely missing. If the user front-loaded everything, it skips straight to design.

**What the agent needs** (asks only for gaps):
- **Name** — suggest one if the user didn't provide it
- **Goals & Context** — purpose, audience, references
- **Structure** — one-page or multi-page (AskUserQuestion if unclear)
- **Stack** — WordPress theme, React+WP, Vue+WP, or "whatever works best" (AskUserQuestion, skip if obvious)
- **Tone & Style** — visual direction, colors, fonts, inspirations

### Content Strategy

Real-ish copy matching the project's purpose and tone, not lorem ipsum. Stock photos for imagery based on the project description.

## Questionnaire System

The agent uses `AskUserQuestion` to ask structured questions (stack choice, structure, etc.). This is a **separate IPC channel** from the permission system.

### Architecture

| Layer | Component | What it does |
|---|---|---|
| CLI | `headless.ts` `createIpcAskUserHandler()` | Sends `ai:question-request`, awaits `ai:question-response` |
| Main | `agent-manager.ts` | Forwards `ai:question-request` → renderer, `ai:question-response` → CLI |
| IPC | `task-question-request` event | Carries `QuestionRequest` (requestId, taskId, question, options) |
| Redux | `pendingQuestions` in tasks slice | Stores pending questions |
| UI | `TaskQuestionPrompt` | Renders question text + option buttons |
| UI | `TaskChatInput` | Detects pending question, routes typed text as answer |
| IPC | `respondToQuestionHandler` | Sends answer back through main → CLI |

### Rendering

- Question text shown above options
- Options render as a vertical list: bold label + muted description, hover turns text theme color
- No borders, no cards — clean text list
- Chat input placeholder changes to "Or type your own answer..." when a question is pending
- Typing in the chat input and submitting answers the question (bypasses the queue)

## Design Previews

### What they are

Polished, impressive HTML/CSS/JS mockups. Not wireframes — these should look like real sites. The agent generates standalone `.html` files for each option, plus an `index.html` that shows all options side-by-side in iframes.

### How they render

The agent calls `browser_navigate` with the absolute file path (e.g., `/Users/.../previews/index.html`). The agent-manager detects the local file path, starts the preview server (`src/lib/preview-server.ts`), converts the path to `http://localhost:<port>/index.html`, and sends the URL to the browser panel. CSP allows `http://localhost:*` in iframes.

For setup tasks (no real site), the agent-manager sends the task ID instead of `SETUP_SITE_ID` so the browser panel's event matching works correctly.

### Storage

Preview files stored in `~/Studio/previews/`. Not temp — users can revisit. TODO: cleanup when a project is deleted.

### Iteration

Via chat — "Make the hero bigger", "More whitespace", "Can you try a dark version?". When ready, the user commits: "Let's go with this one" / "Build it".

## Post-Creation Transition

When the user commits to a design:

1. **Agent calls `site_create`.** The `createSite` IPC handler automatically migrates any tasks with `SETUP_SITE_ID` to the newly created real site. The task now belongs to the real project.
2. **Sidebar should expand** (TODO: not yet automated).
3. **Floating tour should fire** (TODO: component exists at `src/components/new-ui/floating-tour.tsx` but not integrated).
4. **User should land on Project Detail view** (TODO: not wired).
5. **Build completes.** Task status updates. Browser panel can show the real running site.

## Cleanup: Remove Add-Site Window — DONE

The dedicated add-site Electron window has been fully removed:

- **Deleted:** `add-site-window.ts`, `add-site-root.tsx`
- **Removed:** `openAddSiteWindow` / `closeAddSiteWindow` IPC handlers, preload bridge, renderer `view === 'add-site'` routing, `isAddSiteVisible` menu state
- **Redirected:** Sidebar button → `setCreatingProject(true)`, Menu → `create-project` IPC event, Deeplink → `create-project` route
- **Kept:** `CreateProjectFlow`, `ImportProjectStep`, `AddSiteModal` (existing imports), blueprint deeplink handler

## Architecture

### Main Window

The creation flow runs in the main app window using the existing panel layout:

- **Primary panel** — "What do you want to build?" chooser, then Task chat for spec conversation
- **Browser panel** — Design previews via preview server. Auto-expands when content arrives.
- **Sidebar** — Hidden during first-time creation. "Add project" button shows active state.

### Components

| Component | File | Status |
|---|---|---|
| Chooser (new vs. import) | `src/components/new-ui/create-project/create-project-flow.tsx` | Done |
| Import source picker | `src/components/new-ui/create-project/import-project-step.tsx` | UI done, handlers stubbed |
| Floating tour | `src/components/new-ui/floating-tour.tsx` | Built, not integrated |
| Task chat panel | `src/components/new-ui/tasks/task-chat-panel.tsx` | Done (max-width added) |
| Question prompt | `src/components/new-ui/tasks/task-question-prompt.tsx` | Done |
| Panel layout | `src/components/new-ui/panel-layout.tsx` | Done (auto-start, browser auto-expand) |
| Sidebar | `src/components/new-ui/sidebar.tsx` | Done (scroll fix, active state) |
| Task list | `src/components/new-ui/tasks/task-list.tsx` | Done (setup tasks, orphan cleanup) |
| Preview server | `src/lib/preview-server.ts` | Done |
| Site menu | `src/components/site-menu.tsx` | Done (deselect during creation) |

### AI Pipeline

| Component | File | Status |
|---|---|---|
| System prompt | `tools/common/ai/system-prompt.ts` | Updated (browser_navigate mentions file paths) |
| Site-spec skill | `apps/cli/ai/plugin/skills/site-spec/SKILL.md` | Rewritten (conversational, design phase mandatory) |
| Agent tools | `apps/cli/ai/tools.ts` | Updated (browser_navigate supports local files) |
| Agent manager | `apps/studio/src/modules/ai/lib/agent-manager.ts` | Updated (question IPC, preview server, SETUP_SITE_ID handling) |
| Headless agent | `apps/cli/commands/ai/headless.ts` | Updated (question channel, empty text fix) |
| IPC handlers | `apps/studio/src/modules/ai/lib/ipc-handlers.ts` | Updated (respondToQuestionHandler, task migration) |

### Data

- **Task metadata** — Stored in `appdata-v1.json`. Setup tasks use `siteId: '__project-setup__'`, migrated to real site on creation.
- **Chat messages** — Stored in `localStorage` via Redux listener
- **Design previews** — Stored in `~/Studio/previews/`, served via preview server
- **Session resume** — `TaskMetadata.sessionId` enables resuming if app closes mid-flow

### Constants

- `SETUP_SITE_ID = '__project-setup__'` — placeholder siteId for tasks before a real site exists

## Terminology

- **"Project"** in user-facing copy, not "site"
- Internal code keeps existing naming to avoid churn
- Sidebar uses "Projects" as the section header, "Add project" button
- Menu uses "New Project..." (Cmd+N)
