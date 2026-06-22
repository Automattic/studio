# IPC Coverage Strategy (STU-1864 spike)

Recommendation for protecting the IPC layer against regressions once the E2E suite
moves to the CLI and the remaining UI tests are mocked at the IPC boundary.

## The problem

Today's Playwright E2E tests drive the real UI down through `window.ipcApi` →
`ipcMain` → handler → CLI, so they implicitly exercise the IPC bridge end to end. The
test refactor changes that:

- **Business logic** moves to **CLI integration tests** (no Studio app, no IPC).
- **UI tests** shrink to a small set, **mocked at the IPC layer** — they assert the UI
  fires the right `ipcApi` calls with the right arguments, but don't execute the backend.

That splits the stack cleanly along the IPC seam, which is the goal — but it means **no
test crosses the IPC bridge anymore**. A feature can pass its CLI test and its UI test
and still be broken when invoked for real through UI → IPC → main. The spike question
(from the 2026-06-19 testing-migration call) was how to cover that seam: a runtime
`ipcMain` hook that captures the CLI commands a UI action fires, a static-analysis/linter
that maps the IPC method list to CLI commands, or a small set of tests that exercise a
few real IPC calls — whichever is the **minimal** option that guards against IPC
regressions without paying full E2E cost.

## Key finding: most of the IPC contract is already compiler-enforced

Studio's IPC layer has a **single source of truth** and is fully type-derived. There is
no hand-maintained list of channel names anywhere — they flow from one place:

1. **Source of truth:** the exports of `apps/studio/src/ipc-handlers.ts` (~100 handlers, including ones re-exported from feature modules),
   plus the `IPC_VOID_HANDLERS` list in `apps/studio/src/constants.ts` for the
   send-style ones.
2. **Registration** (`apps/studio/src/index.ts`, `setupIpc()`): a loop over
   `Object.entries(ipcHandlers)` registers each export under its own name via
   `ipcMain.handle` (or `ipcMain.on` for void handlers). Channel name = function name.
3. **Type** (`apps/studio/src/ipc-types.d.ts`): `IpcApi` is a mapped type over
   `keyof IpcHandlers` (= `typeof import('./ipc-handlers')`) that strips the leading
   `IpcMainInvokeEvent` arg and wraps the return in a `Promise` — except void handlers,
   which it maps to `undefined` so `invoke` vs `send` can't be confused.
4. **Preload** (`apps/studio/src/preload.ts`): `const api: IpcApi = { … }`. Because it's
   annotated as the full `IpcApi` (a mapped type with no optional keys), the object
   **must** contain every handler — a missing entry is a compile error.
5. **Renderer:** `window.ipcApi` is typed as `IpcApi` (`ipc-types.d.ts`), accessed via
   `getIpcApi()` (used across ~80 renderer files); every call site is typed — there are no
   `(window as any)` escape hatches.

Because the renderer, preload, and registration all derive from the same handler exports,
`npm run typecheck` (which runs `tsc --noEmit` per workspace, including this one) already
catches the whole **structural** surface of the bridge:

| Regression | Caught by `tsc`? | Why |
| --- | --- | --- |
| Renamed handler | ✅ | Every renderer call site (`getIpcApi().oldName`) stops resolving |
| Changed handler signature | ✅ | Argument types mismatch at every call site |
| New handler not wired into preload | ✅ | `const api: IpcApi` is missing a required key |
| Void handler called with `invoke` (or vice-versa) | ✅ | `IpcVoidHandlers` maps to `undefined`, not `Promise<…>` |
| Wrong channel string in preload | ✅ | Channel arg is typed `keyof IpcHandlers` — a typo isn't assignable |

This was verified directly: `window.ipcApi` is `IpcApi`, not `any` (`ipc-types.d.ts:119-122`),
and the PoC test (below) compiles against the real handler signatures.

## What the compiler does *not* cover

Only **runtime wiring health** — the things type information can't prove:

- contextBridge actually exposed `ipcApi` in the renderer (preload loaded, `webPreferences`
  correct);
- `ipcRenderer.invoke` → `ipcMain.handle` round-trips, and `ipcRenderer.send` →
  `ipcMain.on` for void handlers;
- sender validation (`validateIpcSender`) doesn't wrongly reject;
- arguments and return values actually **serialize** across the process boundary (e.g. a
  non-cloneable value would compile but throw at runtime);
- the bridge survives an Electron upgrade.

This residual gap is small, the same for every handler, and **no static analysis can
cover it** — it only shows up when a real renderer talks to a real main process.

## Evaluating the proposed options

**Static-analysis / linter mapping IPC methods → CLI commands — not recommended.**
It would mostly re-prove what `tsc` already proves (method existence, names, signatures),
but more brittly: it needs a hand-maintained method↔command map and can only check
*structure*. The thing that actually matters — *does handler `X` fire the right CLI
command(s) with the right args* — is **behavior, not structure**, so a linter can't verify
it. The mapping isn't even 1:1 (Sync/Pull fan out to several CLI activities; `restart` =
pause→stop→start), which kills any name-matching heuristic. Net: cost to build and
maintain, with no coverage the compiler doesn't already give.

**Runtime `ipcMain` hook capturing the fired-command stack — not recommended as standing
infra.** Its value is "did the UI fire the right commands for *Start site*." That's an
**orchestration** assertion, and the mocked UI tests already make it — `expect(ipcApiMock.startServer).toHaveBeenCalledWith(…)` — without booting the backend. Implementing it for real
means launching the app and running commands, i.e. the full E2E cost the refactor is
trying to shed. It's dominated on both fronts (orchestration → UI mock; handler→CLI
behavior → a main-process unit test calling the handler directly, as
`ipc-handlers.test.ts` already does).

**A few real IPC round-trip tests — recommended.** This is the only option that covers
the actual residual gap (runtime wiring), and it's cheap: 2–3 tests reusing the existing
Playwright `_electron` harness.

## Recommendation: three layers, highest-leverage first

| Layer | Covers | Cost | Action |
| --- | --- | --- | --- |
| **1. Type system** (exists) | Whole structural contract: every renderer call site maps to a real handler with the right signature; preload is exhaustive | Free | Keep `npm run typecheck` as a required CI gate. Treat it as the primary IPC defense. |
| **2. IPC layer-health smoke tests** (~2–3) | Runtime wiring: contextBridge exposure, invoke/handle + send/on round-trip, sender validation, serialization, Electron-upgrade breakage | ~3 tests on the existing E2E harness | Add the PoC suite (below) to the "IPC flow tests" group. |
| **3. UI integration tests** (already planned) | Orchestration: a UI action fires the correct `ipcApi` call(s) with the correct args (the "*Start site* → 3–4 commands" concern) | Already in scope | Assert the mocked `ipcApi` was called with the expected sequence on a few critical flows. No separate `ipcMain` hook needed. |

**Do not build:** the IPC↔CLI static-analysis linter, or the runtime `ipcMain`
command-stack capture as standing infrastructure. They duplicate Layers 1 and 3 at higher
cost.

## Proof of concept

`apps/studio/e2e/ipc-bridge.test.ts` — three deterministic, side-effect-free smoke tests
on the existing `E2ESession` harness, calling real handlers across the bridge via
`mainWindow.evaluate(() => window.ipcApi.…())`:

1. **Exposure** — `window.ipcApi` and `window.ipcListener.subscribe` are present as
   functions (contextBridge worked).
2. **invoke → primitive** — `isAuthenticated()` returns a `boolean` (invoke/handle +
   sender validation + primitive serialization).
3. **invoke → structured object** — `getAppGlobals().platform === process.platform`
   (object serialization + proof a real main-process handler executed).

Send-style (void) handlers are covered for exposure only; their effects (file logging,
shell open) aren't cheaply observable from the renderer, so a round-trip assertion is left
as a documented extension.

**Status:** compiles and lints clean (`tsc` resolves every `window.ipcApi.*` call against
the real derived signatures; `eslint --fix` clean). It was **not** executed here — the
Playwright harness launches the *packaged* app from `apps/studio/out`, which wasn't built
in this environment. To run locally:

```sh
npm start            # (or a packaging build) to produce apps/studio/out
npx playwright test apps/studio/e2e/ipc-bridge.test.ts
```

## TL;DR

The IPC bridge's structural contract is already a single source of truth enforced by
`tsc`; a static-analysis linter would mostly re-prove that, and a runtime command-stack
hook just re-implements E2E. The only real gap is runtime wiring, which 2–3 round-trip
smoke tests cover cheaply. Recommendation: **rely on the type checker (Layer 1), add a
tiny IPC smoke suite (Layer 2), and let the mocked UI tests own orchestration (Layer 3).**
