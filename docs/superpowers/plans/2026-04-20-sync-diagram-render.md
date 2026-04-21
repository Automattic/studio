# Sync Diagram Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `triangle-layout.tsx` in place so the three environment cards (Local / Production / Staging) are connected by drawn SVG lines with perpendicular-offset arrow buttons, marching-ants animation during active syncs, and a stacked fallback below 720px — without changing any data wiring.

**Architecture:** One `<svg>` overlay + absolutely-positioned HTML arrow buttons inside a CSS-grid container. Pure geometry math lives in a sibling `edge-geometry.ts` for testability; hook, `<Edge>`, and `<ArrowButton>` remain local to `triangle-layout.tsx`. Responsive breakpoint via `ResizeObserver` on the diagram container.

**Tech Stack:** React 18, TypeScript, `@wordpress/components` (Button, Tooltip), TailwindCSS (frame-* tokens + new `edge-march` keyframe), SVG, `ResizeObserver`.

**Spec:** `docs/superpowers/specs/2026-04-20-sync-diagram-render-design.md`
**Spike reference:** `spike/sync-diagram-spike.html`

---

## File Structure

**Create:**
- `apps/studio/src/modules/sync/components/triangle/edge-geometry.ts` — pure math: anchor → path string, arrow button positions, rotation angle.
- `apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts` — unit tests for the math.

**Modify:**
- `apps/studio/tailwind.config.js` — add `march` keyframe + `edge-march` / `edge-march-reverse` animations.
- `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx` — full render rewrite. Data wiring preserved.
- `apps/studio/src/modules/sync/components/triangle/triangle-layout.test.tsx` — no edits required; existing slot-wiring tests still apply.

**Untouched:** `environment-column.tsx`, `sync-gutter.tsx`, `placeholder-card.tsx`, `archived-connections.tsx`, `provisioning-column.tsx`, `environment-badge.tsx`, `slot-derivation.ts`, all sync hooks.

---

## Task 1: Add marching-ants animation to Tailwind config

**Files:**
- Modify: `apps/studio/tailwind.config.js` (keyframes + animation blocks)

- [ ] **Step 1: Add the keyframe**

Locate the `keyframes` object (around line 187). Add a `march` entry alongside the existing keyframes:

```js
keyframes: {
    fade: { /* existing */ },
    'slow-spin': { /* existing */ },
    'arrow-nudge': { /* existing */ },
    'gentle-pulse': { /* existing */ },
    'card-shift': { /* existing */ },
    march: {
        to: { 'stroke-dashoffset': '-12' },
    },
},
```

- [ ] **Step 2: Add the animation**

Below the `keyframes` block is an `animation` block. Add `edge-march` and `edge-march-reverse`:

```js
animation: {
    /* existing entries */
    'edge-march': 'march 1.2s linear infinite',
    'edge-march-reverse': 'march 1.2s linear infinite reverse',
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/tailwind.config.js
git commit -m "$(cat <<'EOF'
Add edge-march keyframe for Sync diagram active state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `edge-geometry.ts` with failing tests

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts`
- Create: `apps/studio/src/modules/sync/components/triangle/edge-geometry.ts`

- [ ] **Step 1: Write the failing tests**

Write file `apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeEdgeGeometry } from './edge-geometry';

describe( 'computeEdgeGeometry', () => {
	it( 'builds the SVG path between two points', () => {
		const g = computeEdgeGeometry( { x: 10, y: 20 }, { x: 30, y: 80 }, 22 );
		expect( g.pathD ).toBe( 'M 10 20 L 30 80' );
	} );

	it( 'returns zero-rotation for a line pointing straight south', () => {
		const g = computeEdgeGeometry( { x: 50, y: 0 }, { x: 50, y: 100 }, 22 );
		expect( Math.round( g.angleDeg ) ).toBe( 0 );
	} );

	it( 'returns +90° rotation for a line pointing east', () => {
		// A south-pointing glyph rotated 0° points south; we need to rotate so it
		// ends up pointing east (i.e. along the line).
		// Pre-convention: angleDeg = Math.atan2(-dx, dy) * 180 / Math.PI.
		// For east: dx>0, dy=0 → atan2(-dx, 0) = -90°.
		const g = computeEdgeGeometry( { x: 0, y: 50 }, { x: 100, y: 50 }, 22 );
		expect( Math.round( g.angleDeg ) ).toBe( -90 );
	} );

	it( 'places push and pull on opposite perpendicular sides of the midpoint', () => {
		// Line from (0,0) → (0,100): perpendicular axis is x.
		const g = computeEdgeGeometry( { x: 0, y: 0 }, { x: 0, y: 100 }, 22 );
		expect( g.midpoint ).toEqual( { x: 0, y: 50 } );
		// push on +perp side (CW-90 of direction), pull on -perp side.
		expect( g.pushCenter.x ).toBeGreaterThan( g.midpoint.x );
		expect( g.pullCenter.x ).toBeLessThan( g.midpoint.x );
		// Equidistant from midpoint.
		expect( Math.abs( g.pushCenter.x - g.midpoint.x ) ).toBeCloseTo( 22 );
		expect( Math.abs( g.pullCenter.x - g.midpoint.x ) ).toBeCloseTo( 22 );
	} );

	it( 'handles zero-length edges without NaN', () => {
		const g = computeEdgeGeometry( { x: 10, y: 10 }, { x: 10, y: 10 }, 22 );
		expect( Number.isFinite( g.angleDeg ) ).toBe( true );
		expect( Number.isFinite( g.pushCenter.x ) ).toBe( true );
		expect( Number.isFinite( g.pushCenter.y ) ).toBe( true );
	} );
} );
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts`
Expected: FAIL with "Cannot find module './edge-geometry'".

- [ ] **Step 3: Implement `edge-geometry.ts`**

Write file `apps/studio/src/modules/sync/components/triangle/edge-geometry.ts`:

```ts
export type Point = { x: number; y: number };

export type EdgeGeometry = {
	pathD: string;
	midpoint: Point;
	angleDeg: number;
	pushCenter: Point;
	pullCenter: Point;
};

/**
 * Compute SVG path and arrow-button placement for an edge connecting two points.
 *
 * - `pathD` is the SVG `d` attribute for a straight line from `a` to `b`.
 * - `angleDeg` is the CSS rotation to apply to a south-pointing glyph (↓) so that
 *   it ends up pointing along the line from `a` to `b`. Formula: `atan2(-dx, dy)`,
 *   which accounts for CSS's clockwise-positive convention in screen coordinates.
 * - `pushCenter` / `pullCenter` sit `offset` px on opposite perpendicular sides of
 *   the midpoint (push on the CW-90 side of the flow direction).
 */
export function computeEdgeGeometry( a: Point, b: Point, offset: number ): EdgeGeometry {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot( dx, dy ) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const perpX = uy; // CW-90 perpendicular to the direction vector.
	const perpY = -ux;
	const midpoint: Point = { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
	const angleDeg = ( Math.atan2( -dx, dy ) * 180 ) / Math.PI;
	return {
		pathD: `M ${ a.x } ${ a.y } L ${ b.x } ${ b.y }`,
		midpoint,
		angleDeg,
		pushCenter: { x: midpoint.x + perpX * offset, y: midpoint.y + perpY * offset },
		pullCenter: { x: midpoint.x - perpX * offset, y: midpoint.y - perpY * offset },
	};
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts`
Expected: PASS, all 5 assertions green.

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint --fix apps/studio/src/modules/sync/components/triangle/edge-geometry.ts apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts`
Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/edge-geometry.ts \
        apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts
git commit -m "$(cat <<'EOF'
Add edge-geometry helper for Sync diagram

Pure-math utility: given two points, returns the SVG path d-attribute,
midpoint, rotation angle for a south-pointing glyph to align with the
line direction, and the push/pull button centers on opposite perpendicular
sides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add refs and `useEdgeAnchors` hook inside `triangle-layout.tsx`

**Files:**
- Modify: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

This task adds the measurement plumbing only — no rendering changes yet. The hook will temporarily be unused until Task 4 wires it in.

- [ ] **Step 1: Add the hook definition at the top of `triangle-layout.tsx`**

Locate the current import block. After the imports and before `type Props`, add:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
// ... existing imports stay above ...
import { computeEdgeGeometry, type Point } from './edge-geometry';

type CardRefs = {
	local: React.RefObject< HTMLDivElement >;
	production: React.RefObject< HTMLDivElement >;
	staging: React.RefObject< HTMLDivElement >;
};

type Anchors = {
	localProd: { a: Point; b: Point } | null;
	localStaging: { a: Point; b: Point } | null;
	prodStaging: { a: Point; b: Point } | null;
};

const EMPTY_ANCHORS: Anchors = { localProd: null, localStaging: null, prodStaging: null };

function anchorPoint(
	card: HTMLDivElement | null,
	container: HTMLDivElement | null,
	side: 'bottom-left' | 'bottom-right' | 'top' | 'left' | 'right',
	inset = 24
): Point | null {
	if ( ! card || ! container ) return null;
	const c = container.getBoundingClientRect();
	const r = card.getBoundingClientRect();
	switch ( side ) {
		case 'bottom-left':
			return { x: r.left + inset - c.left, y: r.bottom - c.top };
		case 'bottom-right':
			return { x: r.right - inset - c.left, y: r.bottom - c.top };
		case 'top':
			return { x: r.left + r.width / 2 - c.left, y: r.top - c.top };
		case 'left':
			return { x: r.left - c.left, y: r.top + r.height / 2 - c.top };
		case 'right':
			return { x: r.right - c.left, y: r.top + r.height / 2 - c.top };
	}
}

function useEdgeAnchors(
	containerRef: React.RefObject< HTMLDivElement >,
	refs: CardRefs
): Anchors {
	const [ anchors, setAnchors ] = useState< Anchors >( EMPTY_ANCHORS );

	useLayoutEffect( () => {
		const recompute = () => {
			const container = containerRef.current;
			const local = refs.local.current;
			const prod = refs.production.current;
			const staging = refs.staging.current;
			const localBL = anchorPoint( local, container, 'bottom-left' );
			const localBR = anchorPoint( local, container, 'bottom-right' );
			const prodTop = anchorPoint( prod, container, 'top' );
			const prodRight = anchorPoint( prod, container, 'right' );
			const stagingTop = anchorPoint( staging, container, 'top' );
			const stagingLeft = anchorPoint( staging, container, 'left' );
			setAnchors( {
				localProd: localBL && prodTop ? { a: localBL, b: prodTop } : null,
				localStaging: localBR && stagingTop ? { a: localBR, b: stagingTop } : null,
				prodStaging: prodRight && stagingLeft ? { a: prodRight, b: stagingLeft } : null,
			} );
		};

		recompute();
		const observed = [
			containerRef.current,
			refs.local.current,
			refs.production.current,
			refs.staging.current,
		].filter( ( el ): el is HTMLDivElement => el !== null );
		const ro = new ResizeObserver( recompute );
		observed.forEach( ( el ) => ro.observe( el ) );
		window.addEventListener( 'resize', recompute );
		return () => {
			ro.disconnect();
			window.removeEventListener( 'resize', recompute );
		};
	}, [ containerRef, refs.local, refs.production, refs.staging ] );

	return anchors;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. The hook compiles but is unused — TS will not error on unused functions.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
git commit -m "$(cat <<'EOF'
Add useEdgeAnchors hook to TriangleLayout

Hook measures the three card rects relative to a container via
ResizeObserver + window resize and returns anchor points for the three
edges. Not yet wired into the render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `Edge` and `ArrowButton` internal components

**Files:**
- Modify: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

- [ ] **Step 1: Add the components below the `useEdgeAnchors` hook**

Insert after the hook definition, before `type Props`:

```tsx
type EdgeState = {
	activeDirection: 'push' | 'pull' | null;
	muted: boolean;
	onPush?: () => void;
	onPull?: () => void;
	pushLabel: string;
	pullLabel: string;
};

const ARROW_OFFSET = 22;

function Edge( {
	anchors,
	state,
}: {
	anchors: { a: Point; b: Point } | null;
	state: EdgeState;
} ) {
	if ( ! anchors ) return null;
	const geom = computeEdgeGeometry( anchors.a, anchors.b, ARROW_OFFSET );
	const pathClass = state.activeDirection
		? state.activeDirection === 'push'
			? 'stroke-frame-theme animate-edge-march'
			: 'stroke-frame-theme animate-edge-march-reverse'
		: state.muted
		? 'stroke-frame-border opacity-40'
		: 'stroke-frame-border';
	const dashClass = state.activeDirection
		? '[stroke-dasharray:6_6]'
		: state.muted
		? '[stroke-dasharray:4_4]'
		: '';
	return (
		<>
			<path
				d={ geom.pathD }
				className={ `fill-none stroke-[1.5] [stroke-linecap:round] ${ pathClass } ${ dashClass }` }
			/>
			<ArrowButton
				center={ geom.pushCenter }
				angleDeg={ geom.angleDeg }
				glyph="↓"
				label={ state.pushLabel }
				active={ state.activeDirection === 'push' }
				onClick={ state.onPush }
			/>
			<ArrowButton
				center={ geom.pullCenter }
				angleDeg={ geom.angleDeg }
				glyph="↑"
				label={ state.pullLabel }
				active={ state.activeDirection === 'pull' }
				onClick={ state.onPull }
			/>
		</>
	);
}

function ArrowButton( {
	center,
	angleDeg,
	glyph,
	label,
	active,
	onClick,
}: {
	center: Point;
	angleDeg: number;
	glyph: '↑' | '↓';
	label: string;
	active: boolean;
	onClick?: () => void;
} ) {
	const disabled = ! onClick;
	return (
		<Tooltip text={ label }>
			<button
				type="button"
				aria-label={ label }
				onClick={ onClick }
				disabled={ disabled }
				className={ `pointer-events-auto absolute grid h-7 w-7 place-items-center rounded-md border ${
					active
						? 'border-frame-theme text-frame-theme'
						: 'border-frame-border bg-frame-surface text-frame-text hover:bg-frame-surface-alt hover:border-frame-text-secondary'
				} ${ disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer' }` }
				style={ {
					left: `${ center.x }px`,
					top: `${ center.y }px`,
					transform: `translate(-50%, -50%) rotate(${ angleDeg }deg)`,
				} }
			>
				{ glyph }
			</button>
		</Tooltip>
	);
}
```

- [ ] **Step 2: Verify `Tooltip` is imported at the top**

Check the existing imports at the top of the file. `Tooltip` from `@wordpress/components` is already imported in the current file. If not, add `Tooltip` to the `@wordpress/components` import.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: zero errors (components are defined but not yet used).

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
git commit -m "$(cat <<'EOF'
Add Edge and ArrowButton internals to TriangleLayout

Stateless sub-components: Edge takes anchors + state and renders the
SVG path plus two rotated ArrowButtons. Not yet wired into render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add active-sync + narrow-width state hooks

**Files:**
- Modify: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

Adds two more helpers that feed the render: one reads push/pull activity from Redux, the other detects narrow container width.

- [ ] **Step 1: Import the sync operations selectors**

Add to the existing imports at the top:

```tsx
import { useAppSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync/sync-operations-slice';
```

- [ ] **Step 2: Add `useActiveDirection` hook**

Insert below the other helpers (after `ArrowButton`):

```tsx
/**
 * Returns 'push' | 'pull' | null for the active sync between `localSiteId` and the
 * given remote site. Reads from the `syncOperations` slice via memoized selectors.
 */
function useActiveDirection(
	localSiteId: string,
	remoteSiteId: number | undefined
): 'push' | 'pull' | null {
	const isPushing = useAppSelector( ( state ) =>
		remoteSiteId !== undefined
			? syncOperationsSelectors.selectIsSiteIdPushing( localSiteId, remoteSiteId )( state )
			: false
	);
	const isPulling = useAppSelector( ( state ) =>
		remoteSiteId !== undefined
			? syncOperationsSelectors.selectIsSiteIdPulling( localSiteId, remoteSiteId )( state )
			: false
	);
	if ( isPushing ) return 'push';
	if ( isPulling ) return 'pull';
	return null;
}
```

- [ ] **Step 3: Add `useIsNarrow` hook**

Insert below `useActiveDirection`:

```tsx
const NARROW_BREAKPOINT = 720;

function useIsNarrow( containerRef: React.RefObject< HTMLDivElement > ): boolean {
	const [ narrow, setNarrow ] = useState( false );
	useEffect( () => {
		const el = containerRef.current;
		if ( ! el ) return;
		const check = () => setNarrow( el.clientWidth < NARROW_BREAKPOINT );
		check();
		const ro = new ResizeObserver( check );
		ro.observe( el );
		return () => ro.disconnect();
	}, [ containerRef ] );
	return narrow;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
git commit -m "$(cat <<'EOF'
Add useActiveDirection + useIsNarrow hooks to TriangleLayout

Active-direction reads push/pull state from the sync operations slice
via existing selectors. Narrow-width detector uses ResizeObserver on
the container.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Replace the render with the diagram layout

**Files:**
- Modify: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

Now the big visual change. Replace the JSX returned from `TriangleLayout`.

- [ ] **Step 1: Read the existing return block**

Open `triangle-layout.tsx` and locate the block starting at `return (` near line 96 — the wrapper `<div className="flex flex-col gap-3 p-6">` and everything through the closing `</div>`.

- [ ] **Step 2: Replace with the new render**

Replace everything from the line that currently starts with `return (` through the matching closing `);` at the end of the component. The snippet below contains **new hook calls** (go at the spot where the old `return (` was — i.e., still inside the function body, above the JSX) **plus the two new return branches** (narrow stacked fallback, then the diagram). Preserve all code above this point (data wiring, slot derivation, existing hooks — unchanged).

```tsx
	const containerRef = useRef< HTMLDivElement >( null );
	const localRef = useRef< HTMLDivElement >( null );
	const productionRef = useRef< HTMLDivElement >( null );
	const stagingRef = useRef< HTMLDivElement >( null );

	const anchors = useEdgeAnchors( containerRef, {
		local: localRef,
		production: productionRef,
		staging: stagingRef,
	} );
	const isNarrow = useIsNarrow( containerRef );

	const localProdActive = useActiveDirection( selectedSite.id, production?.id );
	const localStagingActive = useActiveDirection( selectedSite.id, staging?.id );

	const localProdState: EdgeState = {
		activeDirection: localProdActive,
		muted: ! production,
		onPush: production ? () => syncActions.push( production ) : undefined,
		onPull: production ? () => syncActions.pull( production ) : undefined,
		pushLabel: __( 'Push to Production' ),
		pullLabel: __( 'Pull from Production' ),
	};

	const localStagingState: EdgeState = {
		activeDirection: localStagingActive,
		muted: ! staging,
		onPush: staging ? () => syncActions.push( staging ) : undefined,
		onPull: staging ? () => syncActions.pull( staging ) : undefined,
		pushLabel: __( 'Push to Staging' ),
		pullLabel: __( 'Pull from Staging' ),
	};

	const prodStagingState: EdgeState = {
		activeDirection: null,
		muted: ! production || ! staging,
		onPush:
			production && staging
				? () =>
						void pushToStaging( {
							productionSiteId: production.id,
							stagingSiteId: staging.id,
							options: DEFAULT_STAGING_OPTIONS,
						} )
				: undefined,
		onPull:
			production && staging
				? () =>
						void pullFromStaging( {
							productionSiteId: production.id,
							stagingSiteId: staging.id,
							options: DEFAULT_STAGING_OPTIONS,
							allowWooSync: false,
						} )
				: undefined,
		pushLabel: __( 'Copy Production to Staging' ),
		pullLabel: __( 'Copy Staging to Production' ),
	};

	if ( isNarrow ) {
		return (
			<div ref={ containerRef } className="flex flex-col gap-3 p-6">
				<div ref={ localRef }>
					<EnvironmentColumn
						kind="local"
						label="Local"
						orientation="portrait"
						localSiteId={ selectedSite.id }
						siteName={ selectedSite.name }
						siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
						isRunning={ selectedSite.running }
					/>
				</div>
				{ production && (
					<SyncGutter
						from={ { kind: 'local', label: 'Local' } }
						to={ { kind: 'remote', label: 'Production' } }
						lastPushTimestamp={ production.lastPushTimestamp }
						lastPullTimestamp={ production.lastPullTimestamp }
						pushArrow="↓"
						pullArrow="↑"
						onPush={ () => syncActions.push( production ) }
						onPull={ () => syncActions.pull( production ) }
					/>
				) }
				<div ref={ productionRef }>{ productionSlot }</div>
				{ staging && (
					<SyncGutter
						from={ { kind: 'local', label: 'Local' } }
						to={ { kind: 'remote', label: 'Staging' } }
						lastPushTimestamp={ staging.lastPushTimestamp }
						lastPullTimestamp={ staging.lastPullTimestamp }
						pushArrow="↓"
						pullArrow="↑"
						onPush={ () => syncActions.push( staging ) }
						onPull={ () => syncActions.pull( staging ) }
					/>
				) }
				<div ref={ stagingRef }>{ stagingSlot }</div>
				<ArchivedConnections
					localSiteId={ selectedSite.id }
					archived={ archived }
					isProductionOpen={ ! production }
					isStagingOpen={ ! staging }
				/>
				{ syncActions.pendingSyncTarget && (
					<SyncDialog
						type={ syncActions.pendingSyncTarget.direction }
						localSite={ selectedSite }
						remoteSite={ syncActions.pendingSyncTarget.connectedSite }
						onPush={ syncActions.commitPush }
						onPull={ syncActions.commitPull }
						onRequestClose={ syncActions.closeDialog }
					/>
				) }
			</div>
		);
	}

	return (
		<div
			ref={ containerRef }
			className="relative grid grid-cols-[1fr_1fr] gap-x-12 p-6"
			style={ { gridTemplateRows: 'auto 120px auto' } }
		>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
				<Edge anchors={ anchors.localProd } state={ localProdState } />
				<Edge anchors={ anchors.localStaging } state={ localStagingState } />
				<Edge anchors={ anchors.prodStaging } state={ prodStagingState } />
			</svg>

			<div ref={ localRef } className="col-span-2 row-start-1 justify-self-center">
				<EnvironmentColumn
					kind="local"
					label="Local"
					orientation="portrait"
					localSiteId={ selectedSite.id }
					siteName={ selectedSite.name }
					siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
					isRunning={ selectedSite.running }
				/>
			</div>

			<div ref={ productionRef } className="col-start-1 row-start-3">
				{ productionSlot }
			</div>
			<div ref={ stagingRef } className="col-start-2 row-start-3">
				{ stagingSlot }
			</div>

			<div className="col-span-2 row-start-3 mt-4">
				<ArchivedConnections
					localSiteId={ selectedSite.id }
					archived={ archived }
					isProductionOpen={ ! production }
					isStagingOpen={ ! staging }
				/>
			</div>

			{ syncActions.pendingSyncTarget && (
				<SyncDialog
					type={ syncActions.pendingSyncTarget.direction }
					localSite={ selectedSite }
					remoteSite={ syncActions.pendingSyncTarget.connectedSite }
					onPush={ syncActions.commitPush }
					onPull={ syncActions.commitPull }
					onRequestClose={ syncActions.closeDialog }
				/>
			) }
		</div>
	);
```

- [ ] **Step 3: Remove unused imports**

After the replacement, delete any imports that are no longer referenced:
- `SyncGutter` is still referenced (stacked fallback) — keep.
- The old JSX may have had inline `Button` imports from `@wordpress/components` (used by the Prod↔Staging arrows). `Button` is no longer used directly; remove it from the `@wordpress/components` import line. Keep `Tooltip`.

Run: `npx eslint --fix apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Run existing tests**

Run: `npm test -- apps/studio/src/modules/sync/components/triangle/`
Expected: all existing triangle tests pass (slot-wiring, environment-column, sync-gutter, environment-badge).

- [ ] **Step 6: Manual smoke test in the app**

Start the dev server and click through the Sync tab:

```bash
# Kill any existing Studio process precisely (never broad patterns).
pgrep -fl 'Studio.app' | grep -v 'Code\|Visual' | awk '{print $1}' | xargs -r kill
npm start
```

Verify in the running app:
- Sync tab shows three cards in a triangle.
- Three lines connect Local↔Prod, Local↔Staging, Prod↔Staging.
- Six arrow buttons: two per line, on opposite perpendicular sides. Glyphs point along the line.
- Resize the window narrower than ~720px → layout collapses to stacked cards with existing `SyncGutter` between them.
- Click a push button → confirmation modal or SyncDialog opens.
- Trigger a push → the active edge's line animates (marching ants) in the push direction.

If anything is off, iterate before committing.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
git commit -m "$(cat <<'EOF'
Rewrite TriangleLayout render with drawn SVG connections

Three environment cards connected by SVG lines with perpendicular-offset
arrow buttons that rotate to point along each line. Active syncs drive
a marching-ants animation in the direction of flow. Below 720px
collapses to a stacked layout using the existing SyncGutter.

Data wiring (slot derivation, sync actions, staging provisioning) is
unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite for the sync module**

Run: `npm test -- apps/studio/src/modules/sync`
Expected: all tests pass.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Lint modified files**

Run:

```bash
npx eslint --fix \
  apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx \
  apps/studio/src/modules/sync/components/triangle/edge-geometry.ts \
  apps/studio/src/modules/sync/components/triangle/edge-geometry.test.ts \
  apps/studio/tailwind.config.js
```

Expected: zero warnings/errors.

- [ ] **Step 4: If any lint fixes changed files, amend or new-commit**

```bash
git status
# If there are formatting fixes:
git add -u
git commit -m "Lint fixes for Sync diagram render"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:**
  - Full triangle with three pairs connected → Task 6 renders three `<Edge>` components.
  - One line per pair with two arrow buttons on opposite sides → Task 4 `Edge` + `ArrowButton`.
  - Marching ants for active sync → Task 1 keyframe + Task 4 `animate-edge-march` classes + Task 5 `useActiveDirection`.
  - Muted lines for empty slots → Task 4 `Edge` path class branching on `state.muted`.
  - Stacked fallback below 720px → Task 5 `useIsNarrow` + Task 6 narrow branch.
  - Data wiring unchanged → Task 6 preserves all hooks above the return.

- **Known deferred**: Render tests for the full `TriangleLayout` component are not added — the existing test file explicitly avoids that path due to the required Redux/router/Auth provider setup. Pure geometry tests (Task 2) cover the math; manual verification (Task 6 Step 6) covers wiring. Adding an integration test with full providers is a reasonable follow-up but out of scope for this plan.

- **Rollback**: Every task commits independently. If Task 6 needs to be redone, reset to the Task 5 commit and re-implement the render without losing the helpers.
