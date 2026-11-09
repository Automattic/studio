# Model selector extraction

Standalone extraction from `explore-chat-interactions` (`df73e9575..079d08aff`), adapted to `origin/trunk` at `8eaf0de51`. Branch: `codex/extract-model-selector`. Worktree: `/Users/richtabor/.codex/worktrees/519a/studio`.

## Scope and decisions

- The picker shows saved favorites first, filling any remaining spaces up to three choices with connected starter models. It keeps the current model and effort in a starter slot when available. When favorites fill the list, an unsaved current selection appears after them with a checkmark and drag handle, without a shortcut. Dragging that row into the list, or moving its handle with Up/Down, saves the exact model/effort preset at its new position and assigns its shortcut. Reordering other favorites leaves the extra current row unsaved. An exact favorite match uses its existing row. Search covers the full connected catalog, including Claude by name, and filters the current selection normally. Saved favorites are not capped at three.
- Compact popover with a borderless search header and divider, hover stars, ordered model/effort favorites, always-visible supplied 16px drag handles, provider logos, and a shared far-right shortcut/check/star slot. Existing Menu, Popover, Input, IconButton, and row sizing supply the styling.
- Selecting a model or preset keeps the picker open so effort can be adjusted immediately. Escape, clicking outside, or the Model trigger dismisses it; favorite shortcuts used from the composer keep the picker closed.
- The model picker and its Effort menu open and close instantly, without an entrance or exit transition.
- The sidebar's `ReorderableList` now lives in `lib/ui` and serves both surfaces: stationary neighbors, dimmed source, flat preview, line-and-dot marker, landing animation, reduced-motion support, and Up/Down reordering from model handles. Drop-click suppression expires after the pointerup task so the next deliberate selection works even when the browser omits a drop click. Pointer drops return focus to search; keyboard reordering keeps focus on the handle with a focus indicator around the full row.
- The first nine available favorites use Command+Option+1–9 on macOS and Ctrl+Alt+1–9 elsewhere. Positions follow saved order and remain stable while searching. Busy, locked, hidden, unrelated text-field, composition, and modal contexts are guarded.
- One Effort footer displays the resolved value. Balanced and direct Sonnet/Opus offer Low, Medium, High; Default resolves to Medium. Fast and Strong keep the control disabled with an Unavailable value. Medium selections use Default. Explicit saved model/effort presets remain independent.
- Favorites live in the existing locked `app.json` preferences path shared by Desktop and `studio ui`. Both connectors carry model/effort settings. Session context, resume, queued submissions, input payloads, CLI, and runtime preserve the selected effort. The terminal `/effort` command uses trunk's existing native option picker.
- Existing model-family confirmation and draft/attachment carryover remain. Trunk's current composer validation, send, queue, attachment, and command behavior is retained.
- No new dependencies. No changes to agent prompts, tools, tool results, or skills. No reply references, branching, message-content search, steering/queue UX changes, question/thumbnail changes, transcript/Markdown changes, or general chat exploration preview/document.

## Review the real UI

Use Node 24 (`/Users/richtabor/.nvm/versions/node/v24.18.0/bin`).

```bash
npm -w @studio/ui run playground
```

Open `/model-selector.html` on the playground server. Add `?scheme=dark`, `?favorites=empty`, `?providers=all`, or `?providers=all&state=conversation` to inspect dark mode, direct Claude, and existing-chat family confirmation. The preview renders the real app/composer with an in-memory connector and sample favorites; a reload resets sample preferences.

1. Open Model; inspect standard row/button sizes and visible handles beside logos.
2. Search, star/unstar, clear search, then reorder by dragging or with Up/Down on a handle. Check stationary neighbors, dimmed source, marker, landing, and selecting immediately after the drop.
3. Select a preset and use its shortcut with the popover closed while typing a draft.
4. Change effort; verify the footer and composer agree, Medium is the resolved default, and Fast/Strong keep the footer visible and disabled with an Unavailable value.
5. In the existing-chat preview, select direct Claude and confirm that family switching still asks for a new chat and carries the draft.

## Validation

Repeat the focused checks with:

```bash
npm run typecheck
npm run knip
npm run cli:build:ui
npm test -- apps/ui/src/features/composer apps/ui/src/features/sidebar apps/ui/src/data/core/connectors apps/ui/src/data/agent-runs/use-agent-run.test.tsx apps/ui/src/features/chats/session-view/chat-panel.test.tsx apps/ui/src/router/app-workspace.test.tsx apps/ui/src/data/queries/use-sessions.test.ts apps/ui/src/lib/ui apps/ui/src/lib/keyboard packages/agent/protocol/model-effort.test.ts packages/agent/node/runtime/tests/pi-runtime.test.ts packages/agent/node/tests/run-manager.test.ts packages/agent/node/sessions apps/cli/commands/ai/tests/index.test.ts apps/cli/commands/ai/sessions/tests/resume.test.ts apps/cli/ai/tests/slash-commands.test.ts apps/local/src/tests/model-settings.test.ts packages/common/lib/tests/user-preferences.test.ts
```

- Modified-file `npx eslint --fix`: passed (larger Node heap used for the cross-workspace lint run).
- `npm run typecheck`: passed. A separate, unmodified checkout of the same trunk commit also passed; no baseline diagnostics or added diagnostics.
- 608 tests across 56 files passed: picker/composer, sidebar, shared UI/keyboard, agent-run settings capture, both connectors, session routing/settings, locked preferences, HTTP persistence/validation, CLI/resume, runtime effort, and run-manager payloads.
- `npm run knip`: passed.
- `npm run cli:build:ui`: passed; includes browser UI and CLI builds.
- Playwright checked the real preview in light/dark at 1280×720: search, stars, pointer/keyboard reorder, stationary rows, drop marker, post-drop selection, shortcuts, resolved footer, direct-Claude/unsupported-tier effort behavior, and family confirmation with draft carryover. A 390×844 check confirmed the popup stays within the viewport. No blank page, framework overlay, or relevant application console error; the sample user's Gravatar returns an expected 404.
- The built `studio ui` server started on port 8097 using an isolated temporary config directory; Playwright confirmed the signed-out welcome screen rendered.

## Proof limits

The WordPress.com capability wiring is code-confirmed only: Balanced uses the Responses runtime's reasoning support; Fast disables reasoning-effort forwarding and Strong disables reasoning. Unit tests confirm effort reaches runtime creation. No live provider request, live agent conversation, or Electron/native UI session was run. The preview uses sample data and does not prove provider acceptance. No CI run, push, issue, PR, or merge was performed. Both original checkouts are preserved.
