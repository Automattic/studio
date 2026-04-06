# New Project Creation Flow

## Vision

Studio builds things **powered by WordPress**. Not just sites — anything. A blog, an online store, a social network, a mobile app, a game, a newspaper, a community hub, an API. WordPress is the foundation: data, auth, APIs, media, admin. The frontend can be anything.

Today Studio builds WordPress block themes. But the architecture supports headless builds too — WordPress as the backend with React, Vue, or whatever serves the frontend. The creation flow is the same either way. The agent just uses different tools depending on the stack.

## v1 Scope

**Fully working:** WordPress block theme path — spec → design → build → done.

**Functional but basic:** Headless path — spec → design → `site_create` with default theme → enable REST API → scaffold connected starter app. Polished headless frontend building is future work.

**Existing and unchanged:** Import from Jetpack Backup, WordPress Export (.xml), and WordPress.com sync. These flows use the current `AddSiteModal` module.

**New but stubbed:** "Import anything" via URL — paste any website URL and the agent scrapes design/content to recreate it locally. v1 can fake this with a placeholder flow that captures the URL and creates a basic site inspired by it.

## Flow

The creation flow is the user's **first Task**. It runs in the main window using the existing Task system — primary panel for the spec and chat, browser panel for design previews. When creation is done, the task persists in the sidebar like any other task.

```
Welcome / Auth (existing, unchanged)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│            WHAT DO YOU WANT TO BUILD?                     │
│            (sidebar hidden, full-width)                   │
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
│  Round 1 — Name       │ │  ○ WordPress.com             │
│  Round 2 — Goals      │ │  ○ Pressable                 │
│  Round 3 — Structure  │ │  ○ Jetpack Backup            │
│  Round 4 — Stack      │ │  ○ WordPress Export (.xml)   │
│  Round 5 — Tone/Style │ │  ○ URL                       │
│                       │ │    Paste any website and     │
│  (see Spec Skill)     │ │    we'll pull it in          │
│                       │ └──────────┬───────────────────┘
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
│  as HTML/CSS/JS, rendered in the browser panel.          │
│                                                          │
│  Speed strategy:                                         │
│  1. Show a quick style tile (hero section with colors,   │
│     typography, layout direction) within ~30 seconds     │
│  2. Build out full mockups while user reacts to tiles    │
│  3. Replace tiles with full renders as they complete     │
│                                                          │
│  Files stored in a persistent preview directory           │
│  (not temp — users can revisit later).                   │
│                                                          │
│  Each option is a standalone .html file. An index.html   │
│  ties them together for side-by-side comparison.         │
│                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │  Option A   │ │  Option B   │ │  Option C   │       │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │
│         └───────────────┼───────────────┘               │
│                         ▼                                │
│  User picks / iterates / rejects via chat                │
│  "I like B but make the hero bigger"                     │
│  "The tone feels too corporate — more playful"           │
│  "How does the content feel? What are we missing?"       │
│                         │                                │
│                         ▼                                │
│  User commits: "Let's go with this one"                  │
└─────────────────────────┼────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    BUILD (background task)                │
│                                                          │
│  Sidebar expands. Floating tour introduces the UI:       │
│  "Studio is now building your WordPress. It'll take      │
│   a minute." → points to the new build task              │
│                                                          │
│  User lands on Project Detail view while they wait.      │
│  Exposed to: publishing, sync, preview links.            │
│                                                          │
│  WordPress theme path:                                   │
│    site_create → block theme → wp_cli → validate         │
│    → screenshot → compare to approved design             │
│                                                          │
│  Headless path (React/Vue):                              │
│    site_create with default theme → enable REST/GraphQL  │
│    → scaffold frontend → connect to WP APIs              │
│    (basic starter app for v1)                            │
│                                                          │
│  "Your project is ready!"                                │
└─────────────────────────────────────────────────────────┘
```

## First-Time User Experience

New users see the Welcome and Permissions screens (existing, unchanged — handles WP.com auth). After that:

1. **Creation flow auto-starts.** The "What do you want to build?" screen fills the main window. Sidebar navigation is hidden — no distractions.
2. **Spec and design happen in the primary + browser panels.** The user's first interaction with Studio is a conversation. They don't need to learn the app's full UI yet.
3. **After committing to a design,** the sidebar expands for the first time. A floating tour component (new) points to key elements:
   - The build task in the sidebar ("Studio is building your site")
   - The Project Detail view ("Check out what your project can do")
4. **Project Detail is the holding pattern.** While the agent builds the theme (5+ minutes), the user explores publishing to WordPress.com/Pressable, sync, and preview links. This is productive wait time.
5. **Build completes.** The task updates, the browser panel shows the real site. The user can start a new task to iterate.

Returning users with existing projects skip straight to the main app. The "+ Add project" button in the sidebar triggers the same creation flow, but with the sidebar visible.

## Project Spec Skill

The `site-spec` skill gathers everything the agent needs before designing. It should feel like a conversation, not a form — friendly, quick, and easy to skip through.

### Rounds

**Round 1 — Name**
"What's your project called?" (free-form text, not a questionnaire)

**Round 2 — Goals & Context**
"Tell me more about it." The agent asks about:
- What the project is for (portfolio, business, blog, app, etc.)
- Who it's for (audience)
- Any reference URLs or images the user wants to share
- General goals ("I want people to book appointments", "I want to showcase my work")

This can be one open-ended question or a short back-and-forth. The agent should encourage URLs and images but not require them.

**Round 3 — Structure**
One-page or multi-page? (questionnaire with options)

**Round 4 — Stack**
"How should we build it?" (questionnaire)
- WordPress theme *(recommended)* — Full WordPress with blocks and the editor
- React + WordPress — React handles the frontend, WordPress powers the backend
- Vue + WordPress — Vue handles the frontend, WordPress powers the backend
- Whatever the AI says *(default)* — We'll pick the best approach for your project

"Whatever the AI says" is the default selection. Most users will accept it. Power users who want a specific stack can choose explicitly.

**Round 5 — Tone & Style**
"What should it feel like?" The agent asks about:
- Visual tone (minimal, bold, playful, corporate, editorial, etc.)
- Any brand colors, fonts, or existing visual identity
- Inspirations ("I like how Stripe's site feels", "something like a magazine")

### Content Strategy

The agent generates contextually appropriate content based on the spec — real-ish copy that matches the project's purpose and tone, not lorem ipsum. During the design iteration phase, the agent asks for content feedback:
- "How does the content feel? Is this the right tone?"
- "What are we missing?"
- "Is this the right story for your homepage?"

Stock photos for imagery in v1. The agent should pick relevant ones based on the project description.

### When to Skip

Same rules as today: if the user provides everything upfront, or says "just build something" / "surprise me", skip to design.

## Questionnaire System

The agent uses `AskUserQuestion` to ask structured questions (stack choice, layout, etc.). Both surfaces need proper rendering.

- Agent sends a questionnaire with one or more questions
- UI presents questions **one at a time** in the chat
- Each question can be:
  - **Radio** — pick one from a list of options
  - **Checkbox** — pick multiple
  - **Free-form fallback** — every question also allows typing a custom answer
- User can answer OR ignore the question and type something else to redirect the agent
- CLI renders the same types as terminal prompts (already works via `@inquirer/prompts`)
- Desktop renders them as interactive cards in the chat stream

## Design Previews

### What they are

Polished, impressive HTML/CSS/JS mockups. Not wireframes — these should look like real sites. The agent generates standalone `.html` files for each option, plus an `index.html` that shows all options side-by-side in iframes.

### Where they render

The browser panel in the main window. The existing `BrowserIframeContainer` and tab system can be extended to load local preview files instead of a running site URL.

### Speed strategy

Generating 2-3 polished mockups can take several minutes. To keep the user engaged:

1. **Style tiles first (~30s).** A single "hero" section per option showing color palette, typography, and layout direction. Renders fast, gives the user something to react to immediately.
2. **Full renders replace tiles.** As the agent completes each full mockup, it replaces the corresponding style tile. The user sees progress.
3. **Chat stays active.** While renders build out, the user can comment on the style tiles: "I like the colors in A but the layout in B." The agent incorporates feedback into the full renders.

### Storage

Preview files are stored in a persistent directory per project (not temp). Users can revisit design options later — useful for "actually, I liked the other direction better" moments.

### Iteration

The user iterates on designs via chat:
- "Make the hero bigger"
- "More whitespace"
- "Can you try a dark version?"
- "The tone is too corporate — more playful"

When the user is ready, they commit explicitly: "Let's go with this one" / "Build it" / selecting an option and confirming. The agent should surface a clear moment for this: "Ready to build? Pick your favorite and I'll create your WordPress site."

## Post-Creation Transition

When the user commits to a design, several things happen at once:

1. **Site creation kicks off** as a new background Task. The agent starts `site_create`, builds the theme, installs content — the full build pipeline.
2. **Sidebar expands** for the first time (for new users). The creation task appears in the sidebar.
3. **Floating tour** (new component) — a non-modal tooltip/popover that points to UI elements:
   - Points to the build task: "Studio is now building your WordPress. It'll take a minute."
   - Points to Project Detail: "Your WordPress is booting up. Check out what it can do."
4. **User lands on Project Detail view.** This is where they wait productively — exposed to publishing (WordPress.com, Pressable), sync, and preview links.
5. **Build completes.** Task status updates. Browser panel can show the real running site. User can start new tasks to iterate on the site.

## Headless Fork

The stack choice in Round 4 determines the build path. The fork happens **at build time only** — the spec and design phases are identical regardless of stack.

### Design previews are stack-agnostic

Whether the user chose "WordPress theme" or "React + WordPress," the design previews are the same: standalone HTML/CSS/JS mockups showing how the site should look. The previews are about design direction, not implementation.

### Build step diverges

**WordPress theme path** (fully working):
`site_create` → write block theme files → `wp_cli` for content, menus, settings → `validate_blocks` → `take_screenshot` → compare to approved design → fix drift

**Headless path** (basic for v1):
`site_create` with default theme → enable REST API / GraphQL → scaffold React or Vue project in subdirectory → wire API connections → content managed in WP admin

The headless path produces a working WordPress backend with a connected starter frontend app. The frontend won't be as polished as the theme path — that's future work.

### UI differences for headless projects

After build, headless projects show a "Frontend" section in Project Detail pointing to the React/Vue dev server. The browser panel shows the frontend app instead of the WordPress theme. WP admin is still accessible for content management.

## CLI / UI Parity

The CLI (`studio ai`) and the desktop UI share the same underlying agent, tools, system prompt, and skills. The creation flow works in both interfaces.

### Shared layer (already exists)

| Component | Location | Used by |
|---|---|---|
| Agent config | `apps/cli/ai/agent.ts` | Both |
| System prompt | `tools/common/ai/system-prompt.ts` | Both |
| Studio tools | `apps/cli/ai/tools.ts` | Both |
| `site-spec` skill | `apps/cli/ai/plugin/skills/site-spec/` | Both |
| Headless agent IPC | `apps/cli/commands/ai/headless.ts` | Desktop (forks CLI) |

### Interface layer (differs per surface)

| Concern | CLI | Desktop |
|---|---|---|
| Entry | Terminal prompt | Main window (first Task) |
| Agent process | In-process | Claude Agent SDK in main process |
| Questionnaires | Terminal prompts (`@inquirer/prompts`) | Interactive cards in chat stream |
| Design previews | Opens system browser | Browser panel |
| Progress | Terminal streaming | Activity indicator + browser panel updates |
| Post-creation | Terminal output | Sidebar expansion + floating tour + Project Detail |
| Session persistence | Disk files | `TaskMetadata.sessionId` in Redux |

### Work needed for parity

#### 1. Questionnaire UI (both surfaces)

New questionnaire rendering for structured questions in the chat. See [Questionnaire System](#questionnaire-system) above.

#### 2. Design preview rendering

Browser panel needs to load local HTML preview files. Extend the existing `BrowserIframeContainer` to support local file paths alongside site URLs.

#### 3. Update `site-spec` skill

Current rounds: name, layout. Expand to 5 rounds: name, goals/context, structure, stack, tone/style. See [Project Spec Skill](#project-spec-skill) above.

#### 4. Build step per stack

See [Headless Fork](#headless-fork) above.

#### 5. Floating tour component

New UI component for the post-creation transition. Non-modal tooltip/popover that points to specific DOM elements with a message. Dismissable, appears once.

#### 6. Preview storage

Persistent directory per project for design preview files. Needs a storage location outside temp (probably alongside site data in `~/Studio/`), and cleanup when a project is deleted.

## Cleanup: Remove Add-Site Window

The dedicated add-site Electron window (`add-site-window.ts`) was added recently as a prototype but is now superseded by the Task-based flow in the main window. All of this needs to be removed or redirected.

### Delete

| File | What it is |
|---|---|
| `src/add-site-window.ts` | Dedicated Electron BrowserWindow for add-site |
| `src/components/new-ui/add-site-root.tsx` | Root component for the dedicated window (providers, dot grid background) |

### Remove from

| File | What to remove |
|---|---|
| `src/ipc-handlers.ts` | `openAddSiteWindow` and `closeAddSiteWindow` handler registrations |
| `src/preload.ts` | `openAddSiteWindow` and `closeAddSiteWindow` from the IPC bridge |
| `src/renderer.ts` | `AddSiteRoot` import and `view === 'add-site'` ternary in root component selection |

### Redirect

| File | Current behavior | New behavior |
|---|---|---|
| `src/components/new-ui/sidebar.tsx` | "+ Add project" calls `getIpcApi().openAddSiteWindow()` | Should trigger the creation flow in the main window (start a new creation Task, hide sidebar if needed) |
| `src/menu.ts` | "Add Site..." menu item sends `add-site` IPC event, tracks `isAddSiteVisible` state | Menu item should trigger the main-window creation flow. Remove `isAddSiteVisible` parameter. |
| `src/lib/deeplink/deeplink-handler.ts` | `add-site` deeplink route opens the dedicated window | Should trigger creation flow in the main window with blueprint context |

### Keep

| File | Why |
|---|---|
| `src/components/new-ui/create-project/create-project-flow.tsx` | The chooser UI (new vs. import) moves into the main window's primary panel |
| `src/components/new-ui/create-project/import-project-step.tsx` | Import source picker, still needed |
| `src/modules/add-site/index.tsx` | The `AddSiteModal` handles existing import flows (backup, xml, wpcom sync) — unchanged |
| `src/lib/deeplink/handlers/add-site-with-blueprint.ts` | Blueprint deeplink logic, just needs a different trigger target |

## Architecture

### Main Window (existing)

The creation flow runs in the main app window using the existing panel layout:

- **Primary panel** — Spec chat and creation UI. The "What do you want to build?" chooser renders here initially, then transitions to the Task chat. Creation-specific UI (step indicators, commit button) can render below the chat input.
- **Browser panel** — Design previews during creation. Loads local HTML files via the existing `BrowserIframeContainer`.
- **Sidebar** — Hidden during first-time creation. Expands after the user commits to a design.

### Components

- **`src/components/new-ui/create-project/create-project-flow.tsx`** — Initial chooser (new vs. import), transitions to Task chat
- **`src/components/new-ui/create-project/import-project-step.tsx`** — Import source picker
- **`src/components/new-ui/floating-tour.tsx`** — New: post-creation guided tour
- **`src/components/new-ui/tasks/task-chat-panel.tsx`** — Existing: handles the spec conversation
- **`src/components/new-ui/panel-layout.tsx`** — Existing: manages sidebar visibility

### AI Pipeline

- **System prompt** — `tools/common/ai/system-prompt.ts`
- **`site-spec` skill** — `apps/cli/ai/plugin/skills/site-spec/SKILL.md` (needs expansion)
- **Agent tools** — `apps/cli/ai/tools.ts`
- **Agent manager** — `apps/studio/src/modules/ai/lib/agent-manager.ts`
- **Provider resolver** — `apps/studio/src/modules/ai/lib/provider-resolver.ts`

### Data

- **Task metadata** — Stored in `appdata-v1.json` via existing Task system
- **Chat messages** — Stored in `localStorage` via existing Redux listener
- **Design previews** — Stored in persistent project directory (e.g., `~/Studio/<project>/previews/`)
- **Session resume** — `TaskMetadata.sessionId` enables resuming creation if the app closes mid-flow

## Terminology

- **"Project"** in user-facing copy, not "site"
- Internal code keeps existing naming to avoid churn
- Sidebar already uses "Projects" as the section header
