# Sync Diagram Render — Design

Date: 2026-04-20
Branch: `sync-tab-redesign`
Scope: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

## Context

The Sync tab renders three environment cards — Local (top), Production (bottom-left), Staging (bottom-right) — with push/pull controls between them. The current implementation in `triangle-layout.tsx` uses a CSS grid with labeled `SyncGutter` buttons stacked between the cards. Two problems with that approach:

1. The vertical gap between Local and the bottom cards reads as unintentional whitespace rather than as "connection."
2. The Push/Pull controls are disconnected from the cards they operate on; there is no visual cue that a push means data moving *along* a path from one card to another.

HTML/CSS alone can't represent the relationship between cards as a connection. We need drawn lines.

## Goals

- Render the three cards with **drawn connecting lines** between each pair (Local↔Prod, Local↔Staging, Prod↔Staging).
- Arrow-button controls sit on each line, rotated to point along the line.
- When a sync is running, the relevant line animates (marching ants) in the direction of flow.
- Empty slots (no Production connected, Staging not yet created) still render the diagram triangle with muted lines.
- At narrow widths, collapse to a stacked layout using the existing `SyncGutter` component.

## Non-Goals

- Not a reusable graph primitive. One-shot component. Do not extract `<SyncDiagram>` into `modules/sync/components/` or `apps/studio/src/components/`.
- Not canvas-based. HTML cards + SVG-overlay lines.
- Not a graph library (React Flow, Reaflow, etc). Hand-rolled.
- No changes to data wiring: `useGetConnectedSitesForLocalSiteQuery`, `deriveSlotAssignments`, `useStagingProvisioning`, `useSyncActions`, staging-site mutations — all stay exactly as they are.
- No changes to `EnvironmentColumn`, `PreviewFrame`, `EnvironmentBadge`, `ConnectProductionCard`, `CreateStagingCard`, `ProvisioningColumn`, or `SyncDialog`.

## Decisions

1. **Rewrite `triangle-layout.tsx` in place.** No new component file. No split between "data-aware" and "visual" layers.
2. **Full triangle topology.** All three pairs get drawn lines. Local↔Prod and Local↔Staging are the primary push/pull controls; Prod↔Staging is the existing copy-between-remotes hub.
3. **One line per pair. Two arrow buttons per line**, perpendicular-offset on opposite sides of the line, with the glyphs rotated to point along the line direction. Push goes on the CW-of-flow side; pull on the CCW side.
4. **Marching ants** on the active edge during a sync: `stroke-dasharray: 6 6` + animated `stroke-dashoffset`. Direction via `animation-direction`. 1.2s linear infinite.
5. **Solid lines at rest** for connected slots; **dashed + muted opacity** for edges touching an empty slot placeholder.
6. **Responsive:** below 720px container width, render the existing stacked layout using `SyncGutter`. Above, render the SVG diagram. One `if` branch, same component.

## Component structure

The file stays a single `TriangleLayout` component with small internal helpers (not separate files unless they grow):

```
triangle-layout.tsx
├── TriangleLayout (exported; owns data via existing hooks)
├── useEdgeAnchors (local hook; ResizeObserver + getBoundingClientRect)
├── Edge (local component; one SVG <path> + two <ArrowButton>)
└── ArrowButton (local component; rotated HTML button on the line)
```

If `useEdgeAnchors` grows beyond ~40 lines or gets reused, lift it to `use-edge-anchors.ts` sibling. Not before.

### Render outline

```tsx
function TriangleLayout({ selectedSite }) {
  // existing data wiring — unchanged
  const { production, staging, archived } = deriveSlotAssignments(sites);
  const syncActions = useSyncActions(selectedSite);
  // ...

  const localRef = useRef(null);
  const prodRef = useRef(null);
  const stagingRef = useRef(null);
  const containerRef = useRef(null);

  const anchors = useEdgeAnchors(containerRef, {
    local: localRef, prod: prodRef, staging: stagingRef,
  });

  const isNarrow = /* ResizeObserver on containerRef, width < 720 */;

  if (isNarrow) {
    return <StackedFallback /* renders existing SyncGutter layout */ />;
  }

  return (
    <div ref={containerRef} className="relative grid ...">
      <svg className="absolute inset-0 pointer-events-none">
        <Edge anchors={anchors.localProd}    state={edgeStateLocalProd} />
        <Edge anchors={anchors.localStaging} state={edgeStateLocalStaging} />
        <Edge anchors={anchors.prodStaging}  state={edgeStateProdStaging} />
      </svg>

      <LocalCard ref={localRef} />
      <ProdSlot ref={prodRef} />
      <StagingSlot ref={stagingRef} />

      {/* Arrow buttons — rendered as siblings so they can be real buttons with tooltips */}
      <ArrowButton anchor={...} onClick={...} />
      {/* ... six total */}
    </div>
  );
}
```

### Edge state shape

Per edge, the render computes:

```ts
type EdgeState = {
  activeDirection: 'push' | 'pull' | null;
  muted: boolean;           // at least one endpoint is a placeholder
  onPush?: () => void;      // undefined = disabled
  onPull?: () => void;
  pushLabel: string;        // e.g. "Push to Production"
  pullLabel: string;
};
```

`activeDirection` comes from `syncActions` state. `muted` comes from the slot being a placeholder. Handlers come from `syncActions.push` / `syncActions.pull` for Local↔remote edges, and from the staging-site mutations for the Prod↔Staging edge.

### Anchoring

Edges anchor to fixed points on card borders, not rectangle intersections:
- `local → prod`: bottom of Local (offset ~24px in from bottom-left corner) → top of Prod (centered).
- `local → staging`: bottom of Local (offset ~24px in from bottom-right corner) → top of Staging (centered).
- `prod ↔ staging`: right-middle of Prod → left-middle of Staging.

Coordinates computed relative to the diagram container via `getBoundingClientRect`. `useEdgeAnchors` recomputes on `ResizeObserver` notifications from the container and from each card.

### Arrow button rotation & placement

From the spike (`spike/sync-diagram-spike.html`):

```ts
const dx = b.x - a.x;
const dy = b.y - a.y;
const len = Math.hypot(dx, dy) || 1;
const ux = dx / len, uy = dy / len;
const perpX = uy, perpY = -ux;             // CW-90 perpendicular
const angleDeg = Math.atan2(-dx, dy) * 180 / Math.PI;
const offset = 22;

// push button — on +perp side
pushStyle = { left: midX + perpX * offset, top: midY + perpY * offset,
              transform: `translate(-50%,-50%) rotate(${angleDeg}deg)` };
// pull button — on -perp side
pullStyle = { left: midX - perpX * offset, top: midY - perpY * offset,
              transform: `translate(-50%,-50%) rotate(${angleDeg}deg)` };
```

Buttons are HTML (`<Button variant="secondary">` from `@wordpress/components`, with `Tooltip`) so they keep keyboard focus, tooltips, and a11y labels. The containing SVG uses `pointer-events: none`; buttons sit as absolutely-positioned siblings with `pointer-events: auto`.

### Styling tokens

Reuse existing `frame-*` tokens:
- Line color at rest: `var(--color-frame-border)` thickened (1.5px stroke).
- Muted line: same color, `stroke-dasharray: 4 4`, opacity 0.4.
- Active line: `var(--color-frame-theme)`, `stroke-dasharray: 6 6`, animated dashoffset.
- Arrow button background: `var(--color-frame-surface)`, border `var(--color-frame-border)`, hover border `var(--color-frame-text-secondary)`.
- Active (in-progress) arrow button: border and glyph in `var(--color-frame-theme)`, with a spinner replacing the glyph.

## Responsive

Container-width-based switch at **720px**. Above: SVG diagram. Below: stacked layout reusing `SyncGutter`.

The stacked layout: Local on top, Prod below with a `SyncGutter` between, Staging below that with another `SyncGutter`. The Prod↔Staging copy hub is omitted in stacked mode — it's a secondary affordance and cramming it into a narrow column hurts more than it helps.

## Testing

Existing tests preserved as-is:
- `triangle-layout.test.tsx` — slot assignment + dispatch wiring.
- `environment-column.test.tsx`, `sync-gutter.test.tsx`, `environment-badge.test.tsx` — untouched.

New tests added to `triangle-layout.test.tsx`:
1. Renders three cards and three SVG paths when prod + staging are connected; six arrow buttons present with correct `aria-label`s.
2. Muted class on edges touching an empty slot (no production connected).
3. Active class on the correct edge when `syncActions` reports an active push.
4. Clicking a push arrow button invokes `syncActions.push` with the correct remote.
5. At narrow widths, `SyncGutter` is rendered and SVG is not.

Not tested: exact pixel coordinates (brittle; `jsdom` layout is unreliable), animation frames (CSS, not behavior).

## Open questions / deferred decisions

- **Button side convention** — spike has push on the CW-of-flow side, pull on CCW. May flip after real-world review.
- **Animation color** — currently `frame-theme` (blue). Could use environment color (prod-green for pushes to prod) for stronger semantic reading. Leave as theme blue for v1; revisit.
- **Hover/active styling** on the lines themselves — lines are not currently hoverable. If we later want to show sync history or detail on hover, we'll enable `pointer-events: stroke` per path.

## References

- Spike: `spike/sync-diagram-spike.html`
- Visual references: Vercel deployment graph, GitHub Actions workflow visualizer, Linear project connections, Neon branching UI.
- Internal prior art:
  - Marina's "Redesigning staging tab" Figma (DOTDEV-110): https://www.figma.com/design/ASqz3fW9Go9m5bHL2XiuUR/Redesigning-staging-tab?node-id=8-112466
  - Marina's Studio Sync modal (STU-806): https://www.figma.com/design/RToz6tIuQ7nlZrikBte4GU/Studio?node-id=9870-62654
  - WP.com Hosting Dashboard env cards: https://www.figma.com/design/QOBjujZah0UlGDDdLKZhzi/WordPress.com-Hosting-Dashboard?node-id=16823-195015
