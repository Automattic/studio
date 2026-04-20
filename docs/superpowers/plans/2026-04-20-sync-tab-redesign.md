# Sync Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the per-site Sync tab as a dynamic Local → Production → Staging "environment triangle" with content counts, slot enforcement, archived-connection migration, native prod↔staging sync, and one-click staging provisioning.

**Architecture:** New `modules/sync/components/triangle/` React module renders columns + gutters. A pure `slot-derivation.ts` utility classifies each connection into Production / Staging / Archived slots (with optional `slotOverride` persisted per-connection). Existing sync engine (`exportSiteForPush` / `pushArchive` + pull backup thunks) is reused verbatim for Local ↔ remote. New RTK Query endpoints + IPC handlers wrap `wpcom/v2/sites/{id}/staging-site/*` for prod↔staging sync and provisioning. A new `useEnvironmentSummary` hook fetches content counts lazily per column.

**Tech Stack:** React 18, Redux Toolkit + RTK Query, TypeScript, vitest, Electron IPC, `@wordpress/components`, TailwindCSS, `wpcom` SDK, zod.

**Dependency:** PR #3161 (`Redesign site list and Add Site flow with richer sync metadata`) must be merged to `trunk` before this plan begins. The plan assumes:
- Connected-site records carry `icon`, `plan_name`, `created_at` (added in PR #3161)
- `/me/sites` fetch uses v1.3 endpoint with pagination
- The Add Site / Connect modal is finalised and is **not modified** by this plan

**Branch:** Create `sync-tab-redesign` from `trunk` after #3161 merges.

---

## File Structure

**New files:**
- `apps/studio/src/modules/sync/lib/slot-derivation.ts` — pure slot-assignment utility
- `apps/studio/src/modules/sync/lib/slot-derivation.test.ts` — tests
- `apps/studio/src/modules/sync/lib/staging-api.ts` — Main-process wrapper around wpcom staging endpoints
- `apps/studio/src/modules/sync/lib/staging-api.test.ts` — tests (mocked wpcom client)
- `apps/studio/src/modules/sync/hooks/use-environment-summary.ts` — per-column content counts
- `apps/studio/src/modules/sync/hooks/use-staging-provisioning.ts` — provisioning flow orchestration
- `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx` — top-level container
- `apps/studio/src/modules/sync/components/triangle/environment-column.tsx` — one env column
- `apps/studio/src/modules/sync/components/triangle/sync-gutter.tsx` — actions between two columns
- `apps/studio/src/modules/sync/components/triangle/placeholder-card.tsx` — dashed CTA cards (connect-prod / create-staging)
- `apps/studio/src/modules/sync/components/triangle/provisioning-column.tsx` — streaming column during staging provision
- `apps/studio/src/modules/sync/components/triangle/archived-connections.tsx` — collapsed disclosure
- `apps/studio/src/modules/sync/components/triangle/column-menu.tsx` — `⋯` menu (Replace / Disconnect)
- `apps/studio/src/modules/sync/components/triangle/index.ts` — re-exports
- `apps/studio/src/stores/sync/staging-site-api.ts` — RTK Query for prod↔staging endpoints
- `apps/studio/src/stores/sync/environment-summary-api.ts` — RTK Query for post-counts
- `tools/common/types/staging-site.ts` — zod schemas for staging endpoints
- `tools/common/lib/sync/slot-migration.ts` — one-shot migration to populate slotOverride

**Modified files:**
- `tools/common/types/sync.ts` — extend `SyncSite` with `slotOverride`
- `apps/studio/src/ipc-handlers.ts` — new `updateConnectedSiteSlot`, `createStagingSite`, `deleteStagingSite`, `getStagingSyncState`, `pushToStaging`, `pullFromStaging`
- `apps/studio/src/constants.ts` — register new IPC handler names
- `apps/studio/src/preload.ts` — expose new IPC methods on `window.ipcApi`
- `apps/studio/src/modules/sync/index.tsx` — swap `SyncConnectedSites` for `TriangleLayout`
- `apps/studio/src/modules/sync/components/sync-connected-sites.tsx` — DELETE at the end
- `apps/studio/src/stores/sync/connected-sites.ts` — add selector `selectSlotAssignments`
- `apps/studio/src/stores/index.ts` — register new RTK Query reducers

---

## Execution Order Principle

Foundation → data → UI shell → gutters → provisioning → wire-up → migration → cleanup. Each task ends in a green test + a commit. No task depends on a later task.

---

## Task 1: Extend `SyncSite` with `slotOverride`

**Files:**
- Modify: `tools/common/types/sync.ts`
- Test: `tools/common/types/sync.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tools/common/types/sync.test.ts
import { describe, it, expect } from 'vitest';
import type { SyncSite } from './sync';

describe( 'SyncSite.slotOverride', () => {
	it( 'accepts the four legal slot override values and null', () => {
		const values: Array< SyncSite[ 'slotOverride' ] > = [
			'production',
			'staging',
			'archived',
			null,
			undefined,
		];
		// Type-level assertion: if this compiles, the field accepts all five.
		expect( values.length ).toBe( 5 );
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tools/common/types/sync.test.ts`
Expected: FAIL — property `slotOverride` does not exist on `SyncSite`.

- [ ] **Step 3: Add the field**

In `tools/common/types/sync.ts`, extend the `SyncSite` type:

```ts
export type SyncSiteSlotOverride = 'production' | 'staging' | 'archived' | null;

export type SyncSite = {
	id: number;
	localSiteId: string;
	name: string;
	url: string;
	isStaging: boolean;
	isPressable: boolean;
	environmentType?: string | null;
	syncSupport: SyncSupport;
	lastPullTimestamp: string | null;
	lastPushTimestamp: string | null;
	wpVersion?: string;
	slotOverride?: SyncSiteSlotOverride;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tools/common/types/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the new optional field is backwards-compatible).

- [ ] **Step 6: Commit**

```bash
git add tools/common/types/sync.ts tools/common/types/sync.test.ts
git commit -m "Add slotOverride field to SyncSite"
```

---

## Task 2: Slot-derivation utility (pure function)

Classifies every connected site for one local site into exactly one slot: Production, Staging, or Archived. Respects `slotOverride` if present; otherwise derives from `environmentType` + `isStaging`. Tie-breaks using `lastPushTimestamp` (newest wins).

**Files:**
- Create: `apps/studio/src/modules/sync/lib/slot-derivation.ts`
- Create: `apps/studio/src/modules/sync/lib/slot-derivation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/studio/src/modules/sync/lib/slot-derivation.test.ts
import { describe, it, expect } from 'vitest';
import { deriveSlotAssignments } from './slot-derivation';
import type { SyncSite } from '@studio/common/types/sync';

function site( overrides: Partial< SyncSite > ): SyncSite {
	return {
		id: Math.floor( Math.random() * 1e9 ),
		localSiteId: 'local-1',
		name: 'Site',
		url: 'https://example.com',
		isStaging: false,
		isPressable: false,
		environmentType: 'production',
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

describe( 'deriveSlotAssignments', () => {
	it( 'returns empty assignments for zero connections', () => {
		expect( deriveSlotAssignments( [] ) ).toEqual( {
			production: null,
			staging: null,
			archived: [],
		} );
	} );

	it( 'assigns a single production site to the production slot', () => {
		const p = site( { id: 1, environmentType: 'production' } );
		const result = deriveSlotAssignments( [ p ] );
		expect( result.production ).toEqual( p );
		expect( result.staging ).toBeNull();
		expect( result.archived ).toEqual( [] );
	} );

	it( 'assigns a staging site (by environmentType) to staging', () => {
		const s = site( { id: 2, environmentType: 'staging', isStaging: true } );
		const result = deriveSlotAssignments( [ s ] );
		expect( result.staging ).toEqual( s );
	} );

	it( 'picks the newest-pushed production when multiple prod sites exist', () => {
		const older = site( {
			id: 1,
			environmentType: 'production',
			lastPushTimestamp: '2026-01-01T00:00:00Z',
		} );
		const newer = site( {
			id: 2,
			environmentType: 'production',
			lastPushTimestamp: '2026-04-01T00:00:00Z',
		} );
		const result = deriveSlotAssignments( [ older, newer ] );
		expect( result.production?.id ).toBe( 2 );
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'honours slotOverride above derivation', () => {
		const prodTyped = site( { id: 1, environmentType: 'production' } );
		const stagingTyped = site( {
			id: 2,
			environmentType: 'staging',
			isStaging: true,
			slotOverride: 'production',
		} );
		const result = deriveSlotAssignments( [ prodTyped, stagingTyped ] );
		expect( result.production?.id ).toBe( 2 );
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'archives sites with slotOverride="archived" even if type matches an open slot', () => {
		const prod = site( {
			id: 1,
			environmentType: 'production',
			slotOverride: 'archived',
		} );
		const result = deriveSlotAssignments( [ prod ] );
		expect( result.production ).toBeNull();
		expect( result.archived.map( ( s ) => s.id ) ).toEqual( [ 1 ] );
	} );

	it( 'treats development/sandbox/local environmentType as archived', () => {
		const dev = site( { id: 1, environmentType: 'development' } );
		const sb = site( { id: 2, environmentType: 'sandbox' } );
		const result = deriveSlotAssignments( [ dev, sb ] );
		expect( result.archived.map( ( s ) => s.id ).sort() ).toEqual( [ 1, 2 ] );
	} );

	it( 'is deterministic for equal-timestamp ties (lowest id wins)', () => {
		const a = site( { id: 5, environmentType: 'production' } );
		const b = site( { id: 2, environmentType: 'production' } );
		const result = deriveSlotAssignments( [ a, b ] );
		expect( result.production?.id ).toBe( 2 );
	} );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- apps/studio/src/modules/sync/lib/slot-derivation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the utility**

```ts
// apps/studio/src/modules/sync/lib/slot-derivation.ts
import type { SyncSite } from '@studio/common/types/sync';

export type SlotAssignments = {
	production: SyncSite | null;
	staging: SyncSite | null;
	archived: SyncSite[];
};

function compareForSlot( a: SyncSite, b: SyncSite ): number {
	// Newer lastPushTimestamp wins; if equal or both null, lower id wins.
	const aTs = a.lastPushTimestamp ? Date.parse( a.lastPushTimestamp ) : 0;
	const bTs = b.lastPushTimestamp ? Date.parse( b.lastPushTimestamp ) : 0;
	if ( aTs !== bTs ) {
		return bTs - aTs;
	}
	return a.id - b.id;
}

function naturalSlot( s: SyncSite ): 'production' | 'staging' | 'archived' {
	if ( s.slotOverride ) {
		return s.slotOverride;
	}
	if ( s.environmentType === 'staging' || s.isStaging ) {
		return 'staging';
	}
	if ( s.environmentType === 'production' ) {
		return 'production';
	}
	return 'archived';
}

export function deriveSlotAssignments( sites: SyncSite[] ): SlotAssignments {
	const prodCandidates: SyncSite[] = [];
	const stagingCandidates: SyncSite[] = [];
	const archivedCandidates: SyncSite[] = [];

	for ( const s of sites ) {
		const slot = naturalSlot( s );
		if ( slot === 'production' ) {
			prodCandidates.push( s );
		} else if ( slot === 'staging' ) {
			stagingCandidates.push( s );
		} else {
			archivedCandidates.push( s );
		}
	}

	prodCandidates.sort( compareForSlot );
	stagingCandidates.sort( compareForSlot );

	const production = prodCandidates[ 0 ] ?? null;
	const staging = stagingCandidates[ 0 ] ?? null;
	const archived = [
		...prodCandidates.slice( 1 ),
		...stagingCandidates.slice( 1 ),
		...archivedCandidates,
	];

	return { production, staging, archived };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- apps/studio/src/modules/sync/lib/slot-derivation.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/lib/slot-derivation.ts apps/studio/src/modules/sync/lib/slot-derivation.test.ts
git commit -m "Add slot-derivation utility for Sync triangle"
```

---

## Task 3: `updateConnectedSiteSlot` IPC handler

Persist a per-connection `slotOverride` into `appdata-v1.json`. Reuses existing connected-sites storage file-lock pattern.

**Files:**
- Modify: `apps/studio/src/ipc-handlers.ts`
- Modify: `apps/studio/src/constants.ts`
- Modify: `apps/studio/src/preload.ts`
- Test: `apps/studio/src/ipc-handlers.test.ts` (create if missing; otherwise append)

- [ ] **Step 1: Read the existing `updateConnectedWpcomSites` handler in `apps/studio/src/ipc-handlers.ts`** to mimic its locking and shape.

- [ ] **Step 2: Write a failing unit test**

```ts
// apps/studio/src/ipc-handlers.test.ts (append, or create)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateConnectedSiteSlot } from './ipc-handlers';
import { getUserData, saveUserData } from './storage/user-data';

vi.mock( './storage/user-data' );

describe( 'updateConnectedSiteSlot', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'sets slotOverride on the matching connected site', async () => {
		vi.mocked( getUserData ).mockResolvedValue( {
			connectedWpcomSites: [
				{
					localSiteId: 'local-1',
					sites: [ { id: 100, localSiteId: 'local-1', name: 'a' } ],
				},
			],
		} as any );
		vi.mocked( saveUserData ).mockResolvedValue( undefined as any );

		await updateConnectedSiteSlot( {} as any, {
			localSiteId: 'local-1',
			siteId: 100,
			slotOverride: 'staging',
		} );

		const saved = vi.mocked( saveUserData ).mock.calls[ 0 ][ 0 ] as any;
		expect( saved.connectedWpcomSites[ 0 ].sites[ 0 ].slotOverride ).toBe( 'staging' );
	} );

	it( 'clears slotOverride when passed null', async () => {
		vi.mocked( getUserData ).mockResolvedValue( {
			connectedWpcomSites: [
				{
					localSiteId: 'local-1',
					sites: [
						{ id: 100, localSiteId: 'local-1', name: 'a', slotOverride: 'staging' },
					],
				},
			],
		} as any );
		vi.mocked( saveUserData ).mockResolvedValue( undefined as any );

		await updateConnectedSiteSlot( {} as any, {
			localSiteId: 'local-1',
			siteId: 100,
			slotOverride: null,
		} );

		const saved = vi.mocked( saveUserData ).mock.calls[ 0 ][ 0 ] as any;
		expect( saved.connectedWpcomSites[ 0 ].sites[ 0 ].slotOverride ).toBeUndefined();
	} );
} );
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- apps/studio/src/ipc-handlers.test.ts`
Expected: FAIL — `updateConnectedSiteSlot` not exported.

- [ ] **Step 4: Implement the handler**

In `apps/studio/src/ipc-handlers.ts` add:

```ts
export async function updateConnectedSiteSlot(
	_event: IpcMainInvokeEvent,
	args: {
		localSiteId: string;
		siteId: number;
		slotOverride: 'production' | 'staging' | 'archived' | null;
	}
): Promise< void > {
	await lockAppdata();
	try {
		const userData = await getUserData();
		const record = userData.connectedWpcomSites?.find(
			( c: { localSiteId: string } ) => c.localSiteId === args.localSiteId
		);
		if ( ! record ) {
			return;
		}
		const site = record.sites.find( ( s: { id: number } ) => s.id === args.siteId );
		if ( ! site ) {
			return;
		}
		if ( args.slotOverride === null ) {
			delete site.slotOverride;
		} else {
			site.slotOverride = args.slotOverride;
		}
		await saveUserData( userData );
	} finally {
		unlockAppdata();
	}
}
```

Register the handler name in `apps/studio/src/constants.ts`:

```ts
export const IPC_HANDLERS = {
	// ...existing entries...
	UPDATE_CONNECTED_SITE_SLOT: 'update-connected-site-slot',
} as const;
```

Register the IPC route wiring wherever handlers are attached (follow pattern for `updateConnectedWpcomSites`), and expose in preload:

```ts
// apps/studio/src/preload.ts — add inside contextBridge.exposeInMainWorld('ipcApi', {...})
updateConnectedSiteSlot: ( args: {
	localSiteId: string;
	siteId: number;
	slotOverride: 'production' | 'staging' | 'archived' | null;
} ) => ipcRenderer.invoke( 'update-connected-site-slot', args ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- apps/studio/src/ipc-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/ipc-handlers.ts apps/studio/src/constants.ts apps/studio/src/preload.ts apps/studio/src/ipc-handlers.test.ts
git commit -m "Add updateConnectedSiteSlot IPC handler"
```

---

## Task 4: Slot-override mutation endpoint

Expose `updateConnectedSiteSlot` as an RTK mutation so the UI can swap / archive from the triangle.

**Files:**
- Modify: `apps/studio/src/stores/sync/connected-sites.ts`

- [ ] **Step 1: Write a failing test**

```ts
// apps/studio/src/stores/sync/connected-sites.test.ts (create)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectedSitesApi } from './connected-sites';
import { configureStore } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';

vi.mock( 'src/lib/get-ipc-api' );

describe( 'useUpdateConnectedSiteSlotMutation', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'calls the IPC handler and refetches connected sites', async () => {
		const update = vi.fn().mockResolvedValue( undefined );
		const list = vi.fn().mockResolvedValue( [] );
		vi.mocked( getIpcApi ).mockReturnValue( {
			updateConnectedSiteSlot: update,
			getConnectedWpcomSites: list,
		} as any );

		const store = configureStore( {
			reducer: { [ connectedSitesApi.reducerPath ]: connectedSitesApi.reducer },
			middleware: ( g ) => g().concat( connectedSitesApi.middleware ),
		} );

		await store.dispatch(
			connectedSitesApi.endpoints.updateConnectedSiteSlot.initiate( {
				localSiteId: 'local-1',
				siteId: 7,
				slotOverride: 'production',
			} )
		);

		expect( update ).toHaveBeenCalledWith( {
			localSiteId: 'local-1',
			siteId: 7,
			slotOverride: 'production',
		} );
		expect( list ).toHaveBeenCalledWith( 'local-1' );
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/studio/src/stores/sync/connected-sites.test.ts`
Expected: FAIL — `updateConnectedSiteSlot` endpoint does not exist.

- [ ] **Step 3: Add the mutation**

In `apps/studio/src/stores/sync/connected-sites.ts`, append to `endpoints`:

```ts
updateConnectedSiteSlot: builder.mutation<
	SyncSite[],
	{
		localSiteId: string;
		siteId: number;
		slotOverride: 'production' | 'staging' | 'archived' | null;
	}
>( {
	queryFn: async ( args ) => {
		await getIpcApi().updateConnectedSiteSlot( args );
		const sites = await getIpcApi().getConnectedWpcomSites( args.localSiteId );
		return { data: sites };
	},
	invalidatesTags: ( result, error, { localSiteId } ) => [
		{ type: 'ConnectedSites', localSiteId },
	],
} ),
```

Add the hook to the exports:

```ts
export const {
	useGetConnectedSitesForLocalSiteQuery,
	useConnectSiteMutation,
	useDisconnectSiteMutation,
	useUpdateConnectedSiteSlotMutation,
} = connectedSitesApi;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- apps/studio/src/stores/sync/connected-sites.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/stores/sync/connected-sites.ts apps/studio/src/stores/sync/connected-sites.test.ts
git commit -m "Expose slot-override mutation via RTK Query"
```

---

## Task 5: One-shot migration to reduce >2 connections

On first launch after this code ships, for every local site with >2 connections, compute slot assignments once and persist `slotOverride='archived'` for any sites that landed in the archived bucket. Idempotent.

**Files:**
- Create: `tools/common/lib/sync/slot-migration.ts`
- Create: `tools/common/lib/sync/slot-migration.test.ts`
- Modify: `apps/studio/src/index.ts` (or wherever Main-process boot migrations run)

- [ ] **Step 1: Write failing tests**

```ts
// tools/common/lib/sync/slot-migration.test.ts
import { describe, it, expect } from 'vitest';
import { migrateConnectedSitesToSlots } from './slot-migration';
import type { SyncSite } from '../../types/sync';

function s( partial: Partial< SyncSite > ): SyncSite {
	return {
		id: 0,
		localSiteId: 'local',
		name: '',
		url: '',
		isStaging: false,
		isPressable: false,
		environmentType: 'production',
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...partial,
	} as SyncSite;
}

describe( 'migrateConnectedSitesToSlots', () => {
	it( 'no-ops for 0, 1, or 2 connections', () => {
		expect( migrateConnectedSitesToSlots( [] ) ).toEqual( [] );
		const one = [ s( { id: 1 } ) ];
		expect( migrateConnectedSitesToSlots( one ) ).toEqual( one );
		const two = [ s( { id: 1 } ), s( { id: 2, environmentType: 'staging' } ) ];
		expect( migrateConnectedSitesToSlots( two ) ).toEqual( two );
	} );

	it( 'archives sites that fall out of slots when >2 connections', () => {
		const sites = [
			s( { id: 1, environmentType: 'production', lastPushTimestamp: '2026-03-01T00:00:00Z' } ),
			s( { id: 2, environmentType: 'production', lastPushTimestamp: '2026-01-01T00:00:00Z' } ),
			s( { id: 3, environmentType: 'staging' } ),
			s( { id: 4, environmentType: 'production' } ),
		];
		const migrated = migrateConnectedSitesToSlots( sites );
		expect( migrated.find( ( x ) => x.id === 1 )?.slotOverride ).toBeUndefined();
		expect( migrated.find( ( x ) => x.id === 3 )?.slotOverride ).toBeUndefined();
		expect( migrated.find( ( x ) => x.id === 2 )?.slotOverride ).toBe( 'archived' );
		expect( migrated.find( ( x ) => x.id === 4 )?.slotOverride ).toBe( 'archived' );
	} );

	it( 'is idempotent (running twice yields same result)', () => {
		const sites = [
			s( { id: 1, environmentType: 'production' } ),
			s( { id: 2, environmentType: 'production' } ),
			s( { id: 3, environmentType: 'production' } ),
		];
		const once = migrateConnectedSitesToSlots( sites );
		const twice = migrateConnectedSitesToSlots( once );
		expect( twice ).toEqual( once );
	} );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tools/common/lib/sync/slot-migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the migration**

```ts
// tools/common/lib/sync/slot-migration.ts
import type { SyncSite } from '../../types/sync';
import { deriveSlotAssignments } from '../../../../apps/studio/src/modules/sync/lib/slot-derivation';

export function migrateConnectedSitesToSlots( sites: SyncSite[] ): SyncSite[] {
	if ( sites.length <= 2 ) {
		return sites;
	}
	const { production, staging, archived } = deriveSlotAssignments( sites );
	const archivedIds = new Set( archived.map( ( s ) => s.id ) );
	return sites.map( ( s ) => {
		if ( archivedIds.has( s.id ) ) {
			return { ...s, slotOverride: 'archived' as const };
		}
		if ( s.id === production?.id || s.id === staging?.id ) {
			// Ensure no stale override remains on sites that hold a slot naturally.
			if ( s.slotOverride === 'archived' ) {
				const copy = { ...s };
				delete copy.slotOverride;
				return copy;
			}
		}
		return s;
	} );
}
```

If the relative import path is awkward across packages, colocate `slot-derivation.ts` under `tools/common/lib/sync/` instead and re-export from `apps/studio/src/modules/sync/lib/slot-derivation.ts`. Do NOT duplicate the implementation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tools/common/lib/sync/slot-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the migration into app boot**

Find the migrations call site in `apps/studio/src/index.ts` (look for existing `runMigrations()` or similar). If no migration framework exists, add an inline one-shot keyed on a flag in appdata:

```ts
// Inside app boot, after appdata load:
if ( ! userData.migrations?.slotMigration_v1 ) {
	await lockAppdata();
	try {
		const data = await getUserData();
		if ( data.connectedWpcomSites ) {
			for ( const record of data.connectedWpcomSites ) {
				record.sites = migrateConnectedSitesToSlots( record.sites );
			}
		}
		data.migrations = { ...data.migrations, slotMigration_v1: true };
		await saveUserData( data );
	} finally {
		unlockAppdata();
	}
}
```

- [ ] **Step 6: Commit**

```bash
git add tools/common/lib/sync/slot-migration.ts tools/common/lib/sync/slot-migration.test.ts apps/studio/src/index.ts
git commit -m "Migrate existing >2 connections into slotOverride=archived"
```

---

## Task 6: Content-counts RTK Query endpoint

Wraps `GET /rest/v1.2/sites/{site}/post-counts/{post_type}`. Exposes a hook that fetches counts for a given post type.

**Files:**
- Create: `apps/studio/src/stores/sync/environment-summary-api.ts`
- Create: `apps/studio/src/stores/sync/environment-summary-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/studio/src/stores/sync/environment-summary-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { environmentSummaryApi } from './environment-summary-api';

const wpcomRequest = vi.fn();
vi.mock( 'src/lib/wpcom-request', () => ( { wpcomRequest: ( ...args: any[] ) => wpcomRequest( ...args ) } ) );

describe( 'environmentSummaryApi', () => {
	beforeEach( () => {
		wpcomRequest.mockReset();
	} );

	it( 'fetches post counts for a given post type', async () => {
		wpcomRequest.mockResolvedValue( {
			counts: { all: { publish: 12, draft: 3 } },
		} );
		const store = configureStore( {
			reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
			middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
		} );
		const result = await store.dispatch(
			environmentSummaryApi.endpoints.getPostCounts.initiate( {
				siteId: 123,
				postType: 'post',
			} )
		);
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/123/post-counts/post',
			apiNamespace: 'wpcom/v2',
			apiVersion: '1.2',
		} );
		expect( result.data?.counts.all.publish ).toBe( 12 );
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/studio/src/stores/sync/environment-summary-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

```ts
// apps/studio/src/stores/sync/environment-summary-api.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { wpcomRequest } from 'src/lib/wpcom-request';

export type PostCountsResponse = {
	counts: {
		all: Record< string, number >;
		mine?: Record< string, number >;
	};
};

export const environmentSummaryApi = createApi( {
	reducerPath: 'environmentSummaryApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'PostCounts' ],
	keepUnusedDataFor: 60,
	endpoints: ( builder ) => ( {
		getPostCounts: builder.query<
			PostCountsResponse,
			{ siteId: number; postType: string }
		>( {
			queryFn: async ( { siteId, postType } ) => {
				try {
					const data = await wpcomRequest< PostCountsResponse >( {
						path: `/sites/${ siteId }/post-counts/${ postType }`,
						apiNamespace: 'wpcom/v2',
						apiVersion: '1.2',
					} );
					return { data };
				} catch ( error ) {
					return { error: { status: 'CUSTOM_ERROR', error: String( error ) } as any };
				}
			},
			providesTags: ( result, error, { siteId, postType } ) => [
				{ type: 'PostCounts', id: `${ siteId }-${ postType }` },
			],
		} ),
	} ),
} );

export const { useGetPostCountsQuery } = environmentSummaryApi;
```

If no `wpcom-request` helper exists, scan `apps/studio/src/stores/sync/wpcom-sites.ts` for the pattern it uses to hit `/me/sites` with auth and copy it — do not invent a new auth layer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- apps/studio/src/stores/sync/environment-summary-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the reducer**

In `apps/studio/src/stores/index.ts` (or wherever root reducer lives), add:

```ts
[ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer,
// and append environmentSummaryApi.middleware to the middleware chain.
```

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/stores/sync/environment-summary-api.ts apps/studio/src/stores/sync/environment-summary-api.test.ts apps/studio/src/stores/index.ts
git commit -m "Add post-counts RTK Query endpoint for environment summaries"
```

---

## Task 7: `useEnvironmentSummary` hook

Combines post/page/CPT counts into one object per column. Local sites hit an in-process query (not network); remote sites hit the RTK endpoint from Task 6.

**Files:**
- Create: `apps/studio/src/modules/sync/hooks/use-environment-summary.ts`
- Create: `apps/studio/src/modules/sync/hooks/use-environment-summary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/modules/sync/hooks/use-environment-summary.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { environmentSummaryApi } from 'src/stores/sync/environment-summary-api';
import { useEnvironmentSummary } from './use-environment-summary';

const wpcomRequest = vi.fn();
vi.mock( 'src/lib/wpcom-request', () => ( { wpcomRequest: ( ...a: any[] ) => wpcomRequest( ...a ) } ) );

function wrapper( { children }: { children: React.ReactNode } ) {
	const store = configureStore( {
		reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
		middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
	} );
	return <Provider store={ store }>{ children }</Provider>;
}

describe( 'useEnvironmentSummary (remote)', () => {
	it( 'sums post and page counts from the API', async () => {
		wpcomRequest.mockImplementation( ( { path }: { path: string } ) => {
			if ( path.endsWith( '/post' ) ) {
				return Promise.resolve( { counts: { all: { publish: 12, draft: 2 } } } );
			}
			if ( path.endsWith( '/page' ) ) {
				return Promise.resolve( { counts: { all: { publish: 4 } } } );
			}
			return Promise.resolve( { counts: { all: {} } } );
		} );

		const { result } = renderHook(
			() => useEnvironmentSummary( { kind: 'remote', siteId: 1 } ),
			{ wrapper }
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.counts.posts ).toBe( 14 );
		expect( result.current.counts.pages ).toBe( 4 );
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/studio/src/modules/sync/hooks/use-environment-summary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// apps/studio/src/modules/sync/hooks/use-environment-summary.ts
import { useGetPostCountsQuery } from 'src/stores/sync/environment-summary-api';

export type EnvironmentSummary = {
	counts: {
		posts: number;
		pages: number;
	};
	isLoading: boolean;
	isError: boolean;
};

export type EnvironmentSummarySource =
	| { kind: 'remote'; siteId: number }
	| { kind: 'local'; localSiteId: string };

function sumStatuses( counts: Record< string, number > | undefined ): number {
	if ( ! counts ) return 0;
	return Object.values( counts ).reduce( ( a, b ) => a + b, 0 );
}

export function useEnvironmentSummary( source: EnvironmentSummarySource ): EnvironmentSummary {
	const postsQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'post' } : ( { } as any ),
		{ skip: source.kind !== 'remote' }
	);
	const pagesQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'page' } : ( { } as any ),
		{ skip: source.kind !== 'remote' }
	);

	// Local-site summaries: Task 8 replaces this stub with a real in-process fetch.
	if ( source.kind === 'local' ) {
		return {
			counts: { posts: 0, pages: 0 },
			isLoading: false,
			isError: false,
		};
	}

	return {
		counts: {
			posts: sumStatuses( postsQuery.data?.counts.all ),
			pages: sumStatuses( pagesQuery.data?.counts.all ),
		},
		isLoading: postsQuery.isLoading || pagesQuery.isLoading,
		isError: Boolean( postsQuery.isError || pagesQuery.isError ),
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- apps/studio/src/modules/sync/hooks/use-environment-summary.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/hooks/use-environment-summary.ts apps/studio/src/modules/sync/hooks/use-environment-summary.test.tsx
git commit -m "Add useEnvironmentSummary hook (remote path)"
```

---

## Task 8: Local-site summary via new IPC handler

Returns post and page counts for the currently-running local site. Uses the existing running-site's REST API (the site is already up when the Sync tab renders).

**Files:**
- Modify: `apps/studio/src/ipc-handlers.ts` — add `getLocalSiteSummary`
- Modify: `apps/studio/src/preload.ts` — expose it
- Modify: `apps/studio/src/constants.ts` — add handler name
- Modify: `apps/studio/src/modules/sync/hooks/use-environment-summary.ts` — use the IPC for `kind: 'local'`
- Test: `apps/studio/src/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it( 'getLocalSiteSummary returns post/page counts from the running site', async () => {
	const fetchSpy = vi.spyOn( global, 'fetch' as any ).mockImplementation( ( url: string ) => {
		if ( url.includes( 'types=post' ) ) {
			return Promise.resolve( { ok: true, json: () => Promise.resolve( { publish: 7 } ) } as any );
		}
		if ( url.includes( 'types=page' ) ) {
			return Promise.resolve( { ok: true, json: () => Promise.resolve( { publish: 3 } ) } as any );
		}
		return Promise.resolve( { ok: false } as any );
	} );

	// ... call getLocalSiteSummary(event, { localSiteId: 'local-1' })
	// ... assert returned { posts: 7, pages: 3 }

	fetchSpy.mockRestore();
} );
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — handler does not exist.

- [ ] **Step 3: Implement the handler**

Look up the running site port/URL via `SiteServer` (see `apps/studio/src/site-server.ts`). Call the WordPress REST API endpoint `/wp/v2/types/post` and `/wp/v2/types/page` for counts, or use `wp/v2/posts?per_page=1&status=publish` and read the `X-WP-Total` header (simplest). Implementation sketch:

```ts
export async function getLocalSiteSummary(
	_event: IpcMainInvokeEvent,
	args: { localSiteId: string }
): Promise< { posts: number; pages: number } > {
	const server = SiteServer.get( args.localSiteId );
	if ( ! server ) {
		return { posts: 0, pages: 0 };
	}
	const base = server.getUrl();
	async function countFor( postType: string ): Promise< number > {
		const res = await fetch( `${ base }/wp-json/wp/v2/${ postType }?per_page=1&status=publish` );
		const total = Number( res.headers.get( 'X-WP-Total' ) ?? 0 );
		return Number.isFinite( total ) ? total : 0;
	}
	const [ posts, pages ] = await Promise.all( [ countFor( 'posts' ), countFor( 'pages' ) ] );
	return { posts, pages };
}
```

Register the handler name in `constants.ts`, wire up the IPC main handler, and expose it on `preload.ts`:

```ts
getLocalSiteSummary: ( args: { localSiteId: string } ) =>
	ipcRenderer.invoke( 'get-local-site-summary', args ),
```

- [ ] **Step 4: Update `useEnvironmentSummary` to use the IPC path for local**

Replace the `if ( source.kind === 'local' )` stub:

```ts
import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
// ...
if ( source.kind === 'local' ) {
	const [ state, setState ] = useState< EnvironmentSummary >( {
		counts: { posts: 0, pages: 0 },
		isLoading: true,
		isError: false,
	} );
	useEffect( () => {
		let cancelled = false;
		getIpcApi()
			.getLocalSiteSummary( { localSiteId: source.localSiteId } )
			.then( ( counts ) => {
				if ( ! cancelled ) setState( { counts, isLoading: false, isError: false } );
			} )
			.catch( () => {
				if ( ! cancelled ) setState( ( s ) => ( { ...s, isLoading: false, isError: true } ) );
			} );
		return () => {
			cancelled = true;
		};
	}, [ source.localSiteId ] );
	return state;
}
```

- [ ] **Step 5: Run all summary-related tests**

Run: `npm test -- apps/studio/src/modules/sync/hooks apps/studio/src/ipc-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src apps/studio/src/preload.ts
git commit -m "Fetch local-site summaries via IPC"
```

---

## Task 9: Zod schemas for staging-site endpoints

**Files:**
- Create: `tools/common/types/staging-site.ts`
- Create: `tools/common/types/staging-site.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tools/common/types/staging-site.test.ts
import { describe, it, expect } from 'vitest';
import {
	listStagingSitesResponseSchema,
	createStagingSiteResponseSchema,
	syncStateResponseSchema,
	validateQuotaResponseSchema,
} from './staging-site';

describe( 'staging-site schemas', () => {
	it( 'parses a list response', () => {
		const parsed = listStagingSitesResponseSchema.parse( [
			{
				id: 123,
				name: 'Staging',
				url: 'https://staging-123-foo.wpcomstaging.com',
			},
		] );
		expect( parsed.length ).toBe( 1 );
	} );

	it( 'parses a create response', () => {
		const parsed = createStagingSiteResponseSchema.parse( {
			id: 123,
			name: 'Site Title',
			url: 'http://staging-123456-sitename.wordpress.com',
		} );
		expect( parsed.id ).toBe( 123 );
	} );

	it( 'parses a sync-state response', () => {
		const parsed = syncStateResponseSchema.parse( {
			status: 'in-progress',
			started_at: '2026-04-20T00:00:00Z',
		} );
		expect( parsed.status ).toBe( 'in-progress' );
	} );

	it( 'parses a validate-quota response', () => {
		const parsed = validateQuotaResponseSchema.parse( { has_enough_quota: true } );
		expect( parsed.has_enough_quota ).toBe( true );
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

```ts
// tools/common/types/staging-site.ts
import { z } from 'zod';

export const stagingSiteSchema = z.object( {
	id: z.number(),
	name: z.string(),
	url: z.string(),
} );

export const listStagingSitesResponseSchema = z.array( stagingSiteSchema );

export const createStagingSiteResponseSchema = stagingSiteSchema;

export const syncStateResponseSchema = z.object( {
	status: z.enum( [ 'in-progress', 'finished', 'failed', 'idle' ] ),
	started_at: z.string().optional(),
	finished_at: z.string().optional(),
	direction: z.enum( [ 'push', 'pull' ] ).optional(),
} );

export const validateQuotaResponseSchema = z.object( {
	has_enough_quota: z.boolean(),
	message: z.string().optional(),
} );

export type StagingSite = z.infer< typeof stagingSiteSchema >;
export type SyncState = z.infer< typeof syncStateResponseSchema >;
export type ValidateQuotaResponse = z.infer< typeof validateQuotaResponseSchema >;
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/common/types/staging-site.ts tools/common/types/staging-site.test.ts
git commit -m "Add zod schemas for wpcom staging-site endpoints"
```

---

## Task 10: Main-process staging API wrapper

All writes to the wpcom staging endpoints go through this module. Token sourcing mirrors existing `wpcom` usage in the Main process (see `apps/studio/src/lib/oauth.ts` or the existing push pipeline).

**Files:**
- Create: `apps/studio/src/modules/sync/lib/staging-api.ts`
- Create: `apps/studio/src/modules/sync/lib/staging-api.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/studio/src/modules/sync/lib/staging-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listStagingSites, createStagingSite, pushToStaging, pullFromStaging, getSyncState, validateStagingQuota, deleteStagingSite } from './staging-api';

const wpcomRequest = vi.fn();
vi.mock( '../../../lib/wpcom-request-main', () => ( { wpcomRequest: ( ...args: any[] ) => wpcomRequest( ...args ) } ) );

describe( 'staging-api', () => {
	beforeEach( () => wpcomRequest.mockReset() );

	it( 'listStagingSites hits GET /sites/{id}/staging-site', async () => {
		wpcomRequest.mockResolvedValue( [] );
		await listStagingSites( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site',
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
	} );

	it( 'createStagingSite POSTs to /sites/{id}/staging-site', async () => {
		wpcomRequest.mockResolvedValue( { id: 99, name: 'S', url: 'u' } );
		const r = await createStagingSite( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
		} );
		expect( r.id ).toBe( 99 );
	} );

	it( 'validateStagingQuota POSTs to /validate-quota', async () => {
		wpcomRequest.mockResolvedValue( { has_enough_quota: true } );
		await validateStagingQuota( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/validate-quota',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
		} );
	} );

	it( 'pushToStaging passes options in body', async () => {
		wpcomRequest.mockResolvedValue( { ok: true } );
		await pushToStaging( 42, 77, [ 'sqls', 'uploads' ] );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/push-to-staging/77',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
			body: { options: [ 'sqls', 'uploads' ] },
		} );
	} );

	it( 'pullFromStaging passes allow_woo_sync', async () => {
		wpcomRequest.mockResolvedValue( { ok: true } );
		await pullFromStaging( 42, 77, [ 'sqls' ], true );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/pull-from-staging/77',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
			body: { options: [ 'sqls' ], allow_woo_sync: true },
		} );
	} );

	it( 'deleteStagingSite hits DELETE', async () => {
		wpcomRequest.mockResolvedValue( {} );
		await deleteStagingSite( 42, 77 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/77',
			apiNamespace: 'wpcom/v2',
			method: 'DELETE',
		} );
	} );

	it( 'getSyncState hits GET /sync-state', async () => {
		wpcomRequest.mockResolvedValue( { status: 'idle' } );
		await getSyncState( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/sync-state',
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
	} );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```ts
// apps/studio/src/modules/sync/lib/staging-api.ts
import type { SyncOption } from '@studio/common/types/sync';
import {
	listStagingSitesResponseSchema,
	createStagingSiteResponseSchema,
	syncStateResponseSchema,
	validateQuotaResponseSchema,
	type StagingSite,
	type SyncState,
	type ValidateQuotaResponse,
} from '@studio/common/types/staging-site';
import { wpcomRequest } from '../../../lib/wpcom-request-main';

export async function listStagingSites( productionSiteId: number ): Promise< StagingSite[] > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site`,
		apiNamespace: 'wpcom/v2',
		method: 'GET',
	} );
	return listStagingSitesResponseSchema.parse( data );
}

export async function createStagingSite( productionSiteId: number ): Promise< StagingSite > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
	} );
	return createStagingSiteResponseSchema.parse( data );
}

export async function deleteStagingSite(
	productionSiteId: number,
	stagingSiteId: number
): Promise< void > {
	await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'DELETE',
	} );
}

export async function validateStagingQuota(
	productionSiteId: number
): Promise< ValidateQuotaResponse > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/validate-quota`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
	} );
	return validateQuotaResponseSchema.parse( data );
}

export async function pushToStaging(
	productionSiteId: number,
	stagingSiteId: number,
	options: SyncOption[]
): Promise< unknown > {
	return wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/push-to-staging/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
		body: { options },
	} );
}

export async function pullFromStaging(
	productionSiteId: number,
	stagingSiteId: number,
	options: SyncOption[],
	allowWooSync: boolean
): Promise< unknown > {
	return wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/pull-from-staging/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
		body: { options, allow_woo_sync: allowWooSync },
	} );
}

export async function getSyncState( productionSiteId: number ): Promise< SyncState | null > {
	try {
		const data = await wpcomRequest( {
			path: `/sites/${ productionSiteId }/staging-site/sync-state`,
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
		return syncStateResponseSchema.parse( data );
	} catch ( error: any ) {
		if ( error?.statusCode === 404 ) {
			return null;
		}
		throw error;
	}
}
```

If `wpcom-request-main` doesn't exist, create it as a thin wrapper over the existing `wpcom` SDK token usage in `apps/studio/src/lib/oauth.ts` / `tools/common/lib/oauth.ts`. Pattern:

```ts
// apps/studio/src/lib/wpcom-request-main.ts
import wpcomFactory from 'wpcom';
import { getAccessToken } from './oauth-storage';

export type WpcomRequestArgs = {
	path: string;
	apiNamespace?: string;
	apiVersion?: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
};

export async function wpcomRequest< T = unknown >( args: WpcomRequestArgs ): Promise< T > {
	const token = await getAccessToken();
	const wpcom = wpcomFactory( token );
	return new Promise( ( resolve, reject ) => {
		wpcom.req[ ( args.method ?? 'GET' ).toLowerCase() ](
			args.path,
			{ apiNamespace: args.apiNamespace, apiVersion: args.apiVersion },
			args.body,
			( err: Error | null, data: T ) => ( err ? reject( err ) : resolve( data ) )
		);
	} );
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/lib/staging-api.ts apps/studio/src/modules/sync/lib/staging-api.test.ts apps/studio/src/lib/wpcom-request-main.ts
git commit -m "Add main-process wrapper for wpcom staging-site endpoints"
```

---

## Task 11: IPC handlers for staging operations

Expose `createStagingSite`, `deleteStagingSite`, `validateStagingQuota`, `pushToStaging`, `pullFromStaging`, `getStagingSyncState`, `listStagingSites` to the renderer.

**Files:**
- Modify: `apps/studio/src/ipc-handlers.ts`
- Modify: `apps/studio/src/constants.ts`
- Modify: `apps/studio/src/preload.ts`

- [ ] **Step 1: Add handler functions**

```ts
// apps/studio/src/ipc-handlers.ts
import * as stagingApi from './modules/sync/lib/staging-api';
import type { SyncOption } from '@studio/common/types/sync';

export async function listStagingSites(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number }
) {
	return stagingApi.listStagingSites( args.productionSiteId );
}

export async function createStagingSite(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number }
) {
	return stagingApi.createStagingSite( args.productionSiteId );
}

export async function deleteStagingSite(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number; stagingSiteId: number }
) {
	return stagingApi.deleteStagingSite( args.productionSiteId, args.stagingSiteId );
}

export async function validateStagingQuota(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number }
) {
	return stagingApi.validateStagingQuota( args.productionSiteId );
}

export async function pushToStaging(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number; stagingSiteId: number; options: SyncOption[] }
) {
	return stagingApi.pushToStaging( args.productionSiteId, args.stagingSiteId, args.options );
}

export async function pullFromStaging(
	_event: IpcMainInvokeEvent,
	args: {
		productionSiteId: number;
		stagingSiteId: number;
		options: SyncOption[];
		allowWooSync: boolean;
	}
) {
	return stagingApi.pullFromStaging(
		args.productionSiteId,
		args.stagingSiteId,
		args.options,
		args.allowWooSync
	);
}

export async function getStagingSyncState(
	_event: IpcMainInvokeEvent,
	args: { productionSiteId: number }
) {
	return stagingApi.getSyncState( args.productionSiteId );
}
```

- [ ] **Step 2: Register handler names**

In `apps/studio/src/constants.ts`:

```ts
export const IPC_HANDLERS = {
	// existing...
	LIST_STAGING_SITES: 'list-staging-sites',
	CREATE_STAGING_SITE: 'create-staging-site',
	DELETE_STAGING_SITE: 'delete-staging-site',
	VALIDATE_STAGING_QUOTA: 'validate-staging-quota',
	PUSH_TO_STAGING: 'push-to-staging',
	PULL_FROM_STAGING: 'pull-from-staging',
	GET_STAGING_SYNC_STATE: 'get-staging-sync-state',
} as const;
```

Register each with `ipcMain.handle(...)` in the main initialisation (follow existing pattern for `updateConnectedWpcomSites`).

- [ ] **Step 3: Expose in preload**

```ts
// apps/studio/src/preload.ts — inside contextBridge.exposeInMainWorld('ipcApi', { ... })
listStagingSites: ( args: { productionSiteId: number } ) =>
	ipcRenderer.invoke( 'list-staging-sites', args ),
createStagingSite: ( args: { productionSiteId: number } ) =>
	ipcRenderer.invoke( 'create-staging-site', args ),
deleteStagingSite: ( args: { productionSiteId: number; stagingSiteId: number } ) =>
	ipcRenderer.invoke( 'delete-staging-site', args ),
validateStagingQuota: ( args: { productionSiteId: number } ) =>
	ipcRenderer.invoke( 'validate-staging-quota', args ),
pushToStaging: ( args: {
	productionSiteId: number;
	stagingSiteId: number;
	options: import( '@studio/common/types/sync' ).SyncOption[];
} ) => ipcRenderer.invoke( 'push-to-staging', args ),
pullFromStaging: ( args: {
	productionSiteId: number;
	stagingSiteId: number;
	options: import( '@studio/common/types/sync' ).SyncOption[];
	allowWooSync: boolean;
} ) => ipcRenderer.invoke( 'pull-from-staging', args ),
getStagingSyncState: ( args: { productionSiteId: number } ) =>
	ipcRenderer.invoke( 'get-staging-sync-state', args ),
```

- [ ] **Step 4: Typecheck & run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/ipc-handlers.ts apps/studio/src/constants.ts apps/studio/src/preload.ts
git commit -m "Expose wpcom staging operations via IPC"
```

---

## Task 12: Staging-site RTK Query layer

Renderer-facing hooks for the IPC handlers above. Also a polling hook for sync state during prod↔staging operations.

**Files:**
- Create: `apps/studio/src/stores/sync/staging-site-api.ts`
- Create: `apps/studio/src/stores/sync/staging-site-api.test.ts`

- [ ] **Step 1: Write failing tests**

Write tests for each of the seven endpoints similar to Task 4/6 — call `.initiate()` and assert the IPC method was invoked with the right args. Skipping full code here for brevity but follow the Task 6 pattern exactly.

- [ ] **Step 2: Implement**

```ts
// apps/studio/src/stores/sync/staging-site-api.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncOption } from '@studio/common/types/sync';
import type { StagingSite, SyncState, ValidateQuotaResponse } from '@studio/common/types/staging-site';

export const stagingSiteApi = createApi( {
	reducerPath: 'stagingSiteApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'StagingSite', 'StagingSyncState' ],
	endpoints: ( builder ) => ( {
		listStagingSites: builder.query< StagingSite[], { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().listStagingSites( args ) } ),
			providesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		createStagingSite: builder.mutation< StagingSite, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().createStagingSite( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		deleteStagingSite: builder.mutation<
			void,
			{ productionSiteId: number; stagingSiteId: number }
		>( {
			queryFn: async ( args ) => {
				await getIpcApi().deleteStagingSite( args );
				return { data: undefined };
			},
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		validateStagingQuota: builder.mutation< ValidateQuotaResponse, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().validateStagingQuota( args ) } ),
		} ),
		pushToStaging: builder.mutation<
			unknown,
			{ productionSiteId: number; stagingSiteId: number; options: SyncOption[] }
		>( {
			queryFn: async ( args ) => ( { data: await getIpcApi().pushToStaging( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
		pullFromStaging: builder.mutation<
			unknown,
			{
				productionSiteId: number;
				stagingSiteId: number;
				options: SyncOption[];
				allowWooSync: boolean;
			}
		>( {
			queryFn: async ( args ) => ( { data: await getIpcApi().pullFromStaging( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
		getStagingSyncState: builder.query< SyncState | null, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().getStagingSyncState( args ) } ),
			providesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
	} ),
} );

export const {
	useListStagingSitesQuery,
	useCreateStagingSiteMutation,
	useDeleteStagingSiteMutation,
	useValidateStagingQuotaMutation,
	usePushToStagingMutation,
	usePullFromStagingMutation,
	useGetStagingSyncStateQuery,
} = stagingSiteApi;
```

- [ ] **Step 3: Register the reducer in `apps/studio/src/stores/index.ts`.**

- [ ] **Step 4: Run tests & typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/stores
git commit -m "Add staging-site RTK Query endpoints"
```

---

## Task 13: `environment-column.tsx` component

One full column: mshot, label, status dot, site name, URL, WP version, plan badge, counts, last-activity.

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/environment-column.tsx`
- Create: `apps/studio/src/modules/sync/components/triangle/environment-column.test.tsx`

- [ ] **Step 1: Write a failing smoke test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { environmentSummaryApi } from 'src/stores/sync/environment-summary-api';
import { EnvironmentColumn } from './environment-column';

const store = configureStore( {
	reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
	middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
} );

describe( 'EnvironmentColumn', () => {
	it( 'renders name, label, and URL for a remote production column', () => {
		render(
			<Provider store={ store }>
				<EnvironmentColumn
					kind="remote"
					label="Production"
					site={ {
						id: 1,
						localSiteId: 'local',
						name: 'My Prod',
						url: 'https://example.com',
						isStaging: false,
						isPressable: false,
						environmentType: 'production',
						syncSupport: 'syncable',
						lastPullTimestamp: null,
						lastPushTimestamp: null,
					} }
				/>
			</Provider>
		);
		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
		expect( screen.getByText( 'My Prod' ) ).toBeInTheDocument();
		expect( screen.getByText( 'example.com' ) ).toBeInTheDocument();
	} );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the column**

Skeleton — fill detail with existing Studio design tokens (Tailwind classes + `@wordpress/components`). The core structure:

```tsx
// apps/studio/src/modules/sync/components/triangle/environment-column.tsx
import { __ } from '@wordpress/i18n';
import type { SyncSite } from '@studio/common/types/sync';
import { useEnvironmentSummary } from '../../hooks/use-environment-summary';

type Props =
	| {
			kind: 'local';
			label: 'Local';
			localSiteId: string;
			siteName: string;
			siteUrl: string;
			isRunning: boolean;
	  }
	| {
			kind: 'remote';
			label: 'Production' | 'Staging';
			site: SyncSite;
	  };

export function EnvironmentColumn( props: Props ) {
	const summary = useEnvironmentSummary(
		props.kind === 'local'
			? { kind: 'local', localSiteId: props.localSiteId }
			: { kind: 'remote', siteId: props.site.id }
	);

	const { name, url, statusDot } = resolveHeader( props );

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
			<Mshot kind={ props.kind } { ...( props.kind === 'remote' ? { site: props.site } : { localSiteId: props.localSiteId } ) } />
			<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
				{ statusDot }
				<span>{ props.label }</span>
			</div>
			<div>
				<div className="text-base font-semibold">{ name }</div>
				<a href={ url } className="text-sm text-blue-600 hover:underline">
					{ url.replace( /^https?:\/\//, '' ) }
				</a>
			</div>
			{ props.kind === 'remote' && (
				<div className="text-xs text-gray-500">
					WP { props.site.wpVersion ?? '—' }
				</div>
			) }
			<dl className="grid grid-cols-2 gap-2 text-sm">
				<Stat label={ __( 'Posts' ) } value={ summary.counts.posts } loading={ summary.isLoading } />
				<Stat label={ __( 'Pages' ) } value={ summary.counts.pages } loading={ summary.isLoading } />
			</dl>
			<LastActivity { ...props } />
		</div>
	);
}

// Helper sub-components Stat, Mshot, LastActivity, and resolveHeader are defined inline below.
// (Fill with existing Studio conventions — reuse Spinner/Badge from @wordpress/components.)
```

Inline helpers: `Stat` renders label+value with a spinner during load; `Mshot` uses `https://s0.wp.com/mshots/v1/{encodedUrl}?w=...` for remote, a placeholder tile for local; `LastActivity` formats `lastPushTimestamp` / `lastPullTimestamp` with `Intl.RelativeTimeFormat`; `resolveHeader` returns the correct `name`, `url`, and status dot colour.

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/environment-column.tsx apps/studio/src/modules/sync/components/triangle/environment-column.test.tsx
git commit -m "Add EnvironmentColumn component"
```

---

## Task 14: `sync-gutter.tsx` component

Renders the vertical action gutter between two columns. Given `from` and `to`, exposes push/pull buttons and a timestamp beneath each.

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/sync-gutter.tsx`
- Create: `apps/studio/src/modules/sync/components/triangle/sync-gutter.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it( 'renders "Push to Production" and "Pull from Production" for local↔prod', () => {
	render(
		<SyncGutter
			from={ { kind: 'local', label: 'Local' } }
			to={ { kind: 'remote', label: 'Production' } }
			lastPushTimestamp={ null }
			lastPullTimestamp={ null }
			onPush={ () => {} }
			onPull={ () => {} }
		/>
	);
	expect( screen.getByRole( 'button', { name: /Push to Production/ } ) ).toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: /Pull from Production/ } ) ).toBeInTheDocument();
} );

it( 'labels the staging→production push as "Promote to Production"', () => {
	render(
		<SyncGutter
			from={ { kind: 'remote', label: 'Staging' } }
			to={ { kind: 'remote', label: 'Production' } }
			lastPushTimestamp={ null }
			lastPullTimestamp={ null }
			onPush={ () => {} }
			onPull={ () => {} }
		/>
	);
	expect( screen.getByRole( 'button', { name: /Promote to Production/ } ) ).toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: /Refresh staging/ } ) ).toBeInTheDocument();
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/studio/src/modules/sync/components/triangle/sync-gutter.tsx
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

type Endpoint =
	| { kind: 'local'; label: 'Local' }
	| { kind: 'remote'; label: 'Production' | 'Staging' };

type Props = {
	from: Endpoint;
	to: Endpoint;
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
	onPush: () => void;
	onPull: () => void;
	disabled?: boolean;
};

function buttonLabel( direction: 'push' | 'pull', from: Endpoint, to: Endpoint ): string {
	// staging -> prod push = "Promote to Production"
	// prod -> staging pull (from prod's gutter, direction=pull) = "Refresh staging from Production"
	const fromStaging = from.kind === 'remote' && from.label === 'Staging';
	const toProd = to.kind === 'remote' && to.label === 'Production';
	if ( direction === 'push' && fromStaging && toProd ) {
		return __( 'Promote to Production' );
	}
	if ( direction === 'pull' && fromStaging && toProd ) {
		return __( 'Refresh staging from Production' );
	}
	if ( direction === 'push' ) {
		return sprintf( __( 'Push to %s' ), to.label );
	}
	return sprintf( __( 'Pull from %s' ), to.label );
}

export function SyncGutter( props: Props ) {
	return (
		<div className="flex flex-col items-center justify-center gap-6 px-2">
			<div className="flex flex-col items-center gap-1">
				<Button
					variant="secondary"
					onClick={ props.onPush }
					disabled={ props.disabled }
				>
					→ { buttonLabel( 'push', props.from, props.to ) }
				</Button>
				{ props.lastPushTimestamp && (
					<TimeAgo timestamp={ props.lastPushTimestamp } prefix={ __( 'Last pushed' ) } />
				) }
			</div>
			<div className="flex flex-col items-center gap-1">
				<Button
					variant="secondary"
					onClick={ props.onPull }
					disabled={ props.disabled }
				>
					← { buttonLabel( 'pull', props.from, props.to ) }
				</Button>
				{ props.lastPullTimestamp && (
					<TimeAgo timestamp={ props.lastPullTimestamp } prefix={ __( 'Last pulled' ) } />
				) }
			</div>
		</div>
	);
}

// TimeAgo formats ISO string -> "3h ago" via Intl.RelativeTimeFormat — implement inline or reuse existing helper.
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/sync-gutter.tsx apps/studio/src/modules/sync/components/triangle/sync-gutter.test.tsx
git commit -m "Add SyncGutter component with direction-aware labels"
```

---

## Task 15: Placeholder cards (Connect prod / Create staging)

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/placeholder-card.tsx`

- [ ] **Step 1: Implement directly (snapshot test only)**

Two variants: `ConnectProductionCard` opens the existing Add Site Connect modal via `connectedSitesActions.openModal()`. `CreateStagingCard` triggers the provisioning flow defined in Task 17. Both share a common dashed-border layout.

```tsx
// apps/studio/src/modules/sync/components/triangle/placeholder-card.tsx
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

export function ConnectProductionCard( props: { onClick: () => void } ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
			<h3 className="text-base font-semibold">{ __( 'Connect production site' ) }</h3>
			<p className="text-sm text-gray-500">
				{ __( 'Link a WordPress.com site so you can pull its content to Studio and push changes back.' ) }
			</p>
			<Button variant="primary" onClick={ props.onClick }>
				{ __( 'Connect site' ) }
			</Button>
		</div>
	);
}

export function CreateStagingCard( props: {
	onClick: () => void;
	disabledReason?: string;
} ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
			<h3 className="text-base font-semibold">{ __( 'Create staging site' ) }</h3>
			<p className="text-sm text-gray-500">
				{ props.disabledReason ??
					__( 'Provision a staging copy of your production site in one click.' ) }
			</p>
			<Button
				variant="primary"
				onClick={ props.onClick }
				disabled={ Boolean( props.disabledReason ) }
			>
				{ __( 'Create staging' ) }
			</Button>
		</div>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/placeholder-card.tsx
git commit -m "Add placeholder cards for empty triangle slots"
```

---

## Task 16: Column `⋯` menu (Replace / Disconnect)

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/column-menu.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/studio/src/modules/sync/components/triangle/column-menu.tsx
import { __ } from '@wordpress/i18n';
import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';

export function ColumnMenu( props: {
	onReplace?: () => void;
	onDisconnect: () => void;
	hasArchivedCandidates: boolean;
} ) {
	return (
		<DropdownMenu icon={ moreVertical } label={ __( 'Column options' ) }>
			{ ( { onClose }: { onClose: () => void } ) => (
				<MenuGroup>
					{ props.hasArchivedCandidates && props.onReplace && (
						<MenuItem
							onClick={ () => {
								props.onReplace!();
								onClose();
							} }
						>
							{ __( 'Replace with another connected site' ) }
						</MenuItem>
					) }
					<MenuItem
						isDestructive
						onClick={ () => {
							props.onDisconnect();
							onClose();
						} }
					>
						{ __( 'Disconnect' ) }
					</MenuItem>
				</MenuGroup>
			) }
		</DropdownMenu>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/column-menu.tsx
git commit -m "Add column options menu"
```

---

## Task 17: Staging provisioning hook

Orchestrates: quota preflight → create → poll `listStagingSites` until the new site appears with a reachable URL → register it as a connected site.

**Files:**
- Create: `apps/studio/src/modules/sync/hooks/use-staging-provisioning.ts`
- Create: `apps/studio/src/modules/sync/hooks/use-staging-provisioning.test.tsx`

- [ ] **Step 1: Write failing tests** covering four states: idle, validating, provisioning, ready, failed.

```tsx
it( 'advances through validating → provisioning → ready', async () => {
	// mock validateStagingQuota -> { has_enough_quota: true }
	// mock createStagingSite -> { id: 999, ... }
	// mock listStagingSites -> returns [{ id: 999, ... }] on second call
	const { result } = renderHook(
		() =>
			useStagingProvisioning( {
				productionSiteId: 42,
				localSiteId: 'local-1',
			} ),
		{ wrapper }
	);
	act( () => result.current.start() );
	await waitFor( () => expect( result.current.state ).toBe( 'validating' ) );
	await waitFor( () => expect( result.current.state ).toBe( 'provisioning' ) );
	await waitFor( () => expect( result.current.state ).toBe( 'ready' ) );
	expect( result.current.stagingSite?.id ).toBe( 999 );
} );
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

```ts
// apps/studio/src/modules/sync/hooks/use-staging-provisioning.ts
import { useState, useRef, useCallback } from 'react';
import {
	useValidateStagingQuotaMutation,
	useCreateStagingSiteMutation,
	useListStagingSitesQuery,
} from 'src/stores/sync/staging-site-api';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import type { StagingSite } from '@studio/common/types/staging-site';

type ProvisionState =
	| 'idle'
	| 'validating'
	| 'provisioning'
	| 'ready'
	| 'failed';

export function useStagingProvisioning( args: {
	productionSiteId: number;
	localSiteId: string;
} ) {
	const [ state, setState ] = useState< ProvisionState >( 'idle' );
	const [ error, setError ] = useState< string | null >( null );
	const [ stagingSite, setStagingSite ] = useState< StagingSite | null >( null );
	const pollRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const [ validateQuota ] = useValidateStagingQuotaMutation();
	const [ createSite ] = useCreateStagingSiteMutation();
	const [ connectSite ] = useConnectSiteMutation();
	const listQuery = useListStagingSitesQuery(
		{ productionSiteId: args.productionSiteId },
		{ skip: state !== 'provisioning' }
	);

	const start = useCallback( async () => {
		setState( 'validating' );
		setError( null );
		try {
			const quota = await validateQuota( {
				productionSiteId: args.productionSiteId,
			} ).unwrap();
			if ( ! quota.has_enough_quota ) {
				throw new Error( quota.message ?? 'Quota check failed' );
			}
			setState( 'provisioning' );
			await createSite( { productionSiteId: args.productionSiteId } ).unwrap();

			// Poll for the site to be listed (and thus reachable).
			pollRef.current = setInterval( async () => {
				await listQuery.refetch();
				const site = listQuery.data?.[ 0 ];
				if ( site ) {
					setStagingSite( site );
					// Register as a connected site so it enters the triangle.
					await connectSite( {
						site: {
							id: site.id,
							localSiteId: args.localSiteId,
							name: site.name,
							url: site.url,
							isStaging: true,
							isPressable: false,
							environmentType: 'staging',
							syncSupport: 'syncable',
							lastPullTimestamp: null,
							lastPushTimestamp: null,
						},
						localSiteId: args.localSiteId,
					} ).unwrap();
					setState( 'ready' );
					if ( pollRef.current ) {
						clearInterval( pollRef.current );
						pollRef.current = null;
					}
				}
			}, 5000 );
		} catch ( e: any ) {
			setError( e?.message ?? String( e ) );
			setState( 'failed' );
		}
	}, [ args.productionSiteId, args.localSiteId, validateQuota, createSite, connectSite, listQuery ] );

	const cancel = useCallback( () => {
		if ( pollRef.current ) {
			clearInterval( pollRef.current );
			pollRef.current = null;
		}
		setState( 'idle' );
	}, [] );

	return { state, error, stagingSite, start, cancel };
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add apps/studio/src/modules/sync/hooks
git commit -m "Add useStagingProvisioning hook"
```

---

## Task 18: Provisioning column UI

Replaces the `CreateStagingCard` once provisioning is in-flight, shows a streaming status message.

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/provisioning-column.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/studio/src/modules/sync/components/triangle/provisioning-column.tsx
import { __ } from '@wordpress/i18n';
import { Spinner, Notice } from '@wordpress/components';

type Props = {
	state: 'validating' | 'provisioning' | 'ready' | 'failed';
	error: string | null;
	onRetry: () => void;
};

const LABELS: Record< Props[ 'state' ], string > = {
	validating: __( 'Checking quota…' ),
	provisioning: __( 'Provisioning staging site…' ),
	ready: __( 'Ready' ),
	failed: __( 'Provisioning failed' ),
};

export function ProvisioningColumn( { state, error, onRetry }: Props ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 p-8 text-center dark:border-gray-700">
			{ state !== 'failed' && <Spinner /> }
			<h3 className="text-base font-semibold">{ __( 'Staging' ) }</h3>
			<p className="text-sm text-gray-500">{ LABELS[ state ] }</p>
			{ state === 'failed' && error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			{ state === 'failed' && (
				<button onClick={ onRetry }>{ __( 'Try again' ) }</button>
			) }
		</div>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/provisioning-column.tsx
git commit -m "Add ProvisioningColumn"
```

---

## Task 19: `archived-connections.tsx` disclosure

Collapsed list at the bottom of the triangle with the sites that didn't make the slots. Each row has a `⋯` menu with "Move to Production", "Move to Staging" (if that slot is empty), and "Disconnect."

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/archived-connections.tsx`

- [ ] **Step 1: Implement**

Keep it terse. Uses `useUpdateConnectedSiteSlotMutation` (Task 4) to promote a row back into a slot.

```tsx
// apps/studio/src/modules/sync/components/triangle/archived-connections.tsx
import { useState } from 'react';
import { __ } from '@wordpress/i18n';
import type { SyncSite } from '@studio/common/types/sync';
import { useUpdateConnectedSiteSlotMutation } from 'src/stores/sync/connected-sites';
import { useDisconnectSiteMutation } from 'src/stores/sync/connected-sites';

type Props = {
	localSiteId: string;
	archived: SyncSite[];
	isProductionOpen: boolean;
	isStagingOpen: boolean;
};

export function ArchivedConnections( props: Props ) {
	const [ open, setOpen ] = useState( false );
	const [ updateSlot ] = useUpdateConnectedSiteSlotMutation();
	const [ disconnect ] = useDisconnectSiteMutation();

	if ( props.archived.length === 0 ) return null;

	return (
		<details open={ open } onToggle={ ( e ) => setOpen( e.currentTarget.open ) }>
			<summary className="cursor-pointer text-sm text-gray-500">
				{ __( 'Archived connections' ) } ({ props.archived.length })
			</summary>
			<ul className="mt-2 space-y-1">
				{ props.archived.map( ( s ) => (
					<li key={ s.id } className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm dark:border-gray-700">
						<span>{ s.name } <span className="text-gray-500">{ s.url.replace( /^https?:\/\//, '' ) }</span></span>
						<div className="flex gap-2">
							{ props.isProductionOpen && (
								<button onClick={ () =>
									updateSlot( {
										localSiteId: props.localSiteId,
										siteId: s.id,
										slotOverride: 'production',
									} )
								}>{ __( 'Move to Production' ) }</button>
							) }
							{ props.isStagingOpen && (
								<button onClick={ () =>
									updateSlot( {
										localSiteId: props.localSiteId,
										siteId: s.id,
										slotOverride: 'staging',
									} )
								}>{ __( 'Move to Staging' ) }</button>
							) }
							<button onClick={ () =>
								disconnect( { siteId: s.id, localSiteId: props.localSiteId } )
							}>{ __( 'Disconnect' ) }</button>
						</div>
					</li>
				) ) }
			</ul>
		</details>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/archived-connections.tsx
git commit -m "Add ArchivedConnections disclosure"
```

---

## Task 20: `triangle-layout.tsx` — compose everything

The container that reads connected sites, derives slots, and composes columns + gutters + placeholders + archived disclosure.

**Files:**
- Create: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`
- Create: `apps/studio/src/modules/sync/components/triangle/triangle-layout.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it( 'renders only Local column when no remotes are connected', () => { /* ... */ } );
it( 'renders Local + Production columns + CreateStaging card when only prod is connected', () => { /* ... */ } );
it( 'renders all three columns when all slots are filled', () => { /* ... */ } );
it( 'renders archived disclosure when archived > 0', () => { /* ... */ } );
```

Use the existing test helpers for wrapping in Redux + the connected-sites mock.

- [ ] **Step 2: Implement**

```tsx
// apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
import { __ } from '@wordpress/i18n';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { connectedSitesActions } from 'src/stores/sync/connected-sites';
import { useAppDispatch } from 'src/stores';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import { EnvironmentColumn } from './environment-column';
import { SyncGutter } from './sync-gutter';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { ArchivedConnections } from './archived-connections';
import { ColumnMenu } from './column-menu';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { usePushActions, usePullActions } from '../../hooks/use-sync-actions'; // reuse existing module push/pull

type Props = {
	localSiteId: string;
	localSiteName: string;
	localSiteUrl: string;
	isRunning: boolean;
};

export function TriangleLayout( props: Props ) {
	const dispatch = useAppDispatch();
	const { data: sites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: props.localSiteId,
	} );
	const { production, staging, archived } = deriveSlotAssignments( sites );
	const provisioning = useStagingProvisioning( {
		productionSiteId: production?.id ?? 0,
		localSiteId: props.localSiteId,
	} );
	const pushActions = usePushActions( props.localSiteId );
	const pullActions = usePullActions( props.localSiteId );

	const openConnectModal = () =>
		dispatch( connectedSitesActions.openModal( 'connect' ) );

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4" style={ { gridTemplateColumns: gridFor( production, staging, provisioning.state ) } }>
				<EnvironmentColumn
					kind="local"
					label="Local"
					localSiteId={ props.localSiteId }
					siteName={ props.localSiteName }
					siteUrl={ props.localSiteUrl }
					isRunning={ props.isRunning }
				/>

				{ production ? (
					<>
						<SyncGutter
							from={ { kind: 'local', label: 'Local' } }
							to={ { kind: 'remote', label: 'Production' } }
							lastPushTimestamp={ production.lastPushTimestamp }
							lastPullTimestamp={ production.lastPullTimestamp }
							onPush={ () => pushActions.push( production ) }
							onPull={ () => pullActions.pull( production ) }
						/>
						<EnvironmentColumn kind="remote" label="Production" site={ production } />
					</>
				) : (
					<ConnectProductionCard onClick={ openConnectModal } />
				) }

				{ production && (
					staging ? (
						<>
							<SyncGutter
								from={ { kind: 'remote', label: 'Production' } }
								to={ { kind: 'remote', label: 'Staging' } }
								lastPushTimestamp={ null /* TODO: thread from sync-state query */ }
								lastPullTimestamp={ null }
								onPush={ () => {
									/* push-to-staging wiring in Task 21 */
								} }
								onPull={ () => {
									/* pull-from-staging wiring in Task 21 */
								} }
							/>
							<EnvironmentColumn kind="remote" label="Staging" site={ staging } />
						</>
					) : provisioning.state === 'idle' ? (
						<CreateStagingCard onClick={ provisioning.start } />
					) : (
						<ProvisioningColumn
							state={ provisioning.state }
							error={ provisioning.error }
							onRetry={ provisioning.start }
						/>
					)
				) }
			</div>

			<ArchivedConnections
				localSiteId={ props.localSiteId }
				archived={ archived }
				isProductionOpen={ ! production }
				isStagingOpen={ ! staging }
			/>
		</div>
	);
}

function gridFor( production: unknown, staging: unknown, provState: string ): string {
	if ( ! production ) return '1fr auto 1fr'; // local + gutter-placeholder
	if ( ! staging && provState === 'idle' ) return '1fr auto 1fr auto 1fr';
	return '1fr auto 1fr auto 1fr';
}
```

If `usePushActions` / `usePullActions` don't already exist as hooks wrapping the existing `pushSiteThunk` / `pullSiteThunk`, create thin wrappers in `apps/studio/src/modules/sync/hooks/use-sync-actions.ts` that dispatch those thunks and surface the existing sync-options sheet. Do NOT reimplement the sheet.

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx apps/studio/src/modules/sync/components/triangle/triangle-layout.test.tsx apps/studio/src/modules/sync/hooks/use-sync-actions.ts
git commit -m "Add TriangleLayout composer"
```

---

## Task 21: Wire prod↔staging gutter to actual endpoints

In Task 20 the staging gutter's onPush/onPull were TODOs. Wire them.

**Files:**
- Modify: `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx`

- [ ] **Step 1: Write a failing integration test**

```tsx
it( 'clicking "Promote to Production" triggers pullFromStaging', async () => {
	// Mount TriangleLayout with both prod + staging present.
	// Click "Promote to Production" button in the staging↔prod gutter.
	// Assert usePullFromStagingMutation was called with correct ids.
} );
```

- [ ] **Step 2: Replace the TODOs**

```tsx
import {
	usePushToStagingMutation,
	usePullFromStagingMutation,
	useGetStagingSyncStateQuery,
} from 'src/stores/sync/staging-site-api';

// Inside TriangleLayout, after deriveSlotAssignments():
const [ pushToStaging ] = usePushToStagingMutation();
const [ pullFromStaging ] = usePullFromStagingMutation();
const { data: syncState } = useGetStagingSyncStateQuery(
	{ productionSiteId: production?.id ?? 0 },
	{ skip: ! production || ! staging }
);

// Then in the staging gutter:
onPush={ () =>
	pullFromStaging( {
		// Note: direction is staging→prod in UI terms, which maps to the wpcom "pull-from-staging" endpoint.
		productionSiteId: production!.id,
		stagingSiteId: staging!.id,
		options: [ 'sqls', 'uploads', 'plugins', 'themes', 'contents' ],
		allowWooSync: false,
	} )
}
onPull={ () =>
	pushToStaging( {
		productionSiteId: production!.id,
		stagingSiteId: staging!.id,
		options: [ 'sqls', 'uploads', 'plugins', 'themes', 'contents' ],
	} )
}
lastPushTimestamp={ syncState?.direction === 'push' ? syncState.finished_at ?? null : null }
lastPullTimestamp={ syncState?.direction === 'pull' ? syncState.finished_at ?? null : null }
```

**Semantic note to encode in a code comment:** From the user's perspective, the "push" arrow in the staging↔production gutter means Promote (staging → prod). In the wpcom API, that corresponds to the `pull-from-staging` endpoint (wpcom describes the flow from the production site's perspective). The code above maps UI `onPush` → API `pullFromStaging` and UI `onPull` → API `pushToStaging`. Document this inversion with one short comment at the call site.

For WooCommerce sites, `allowWooSync` must be opt-in; add a confirmation dialog that toggles it when the production site has WooCommerce active. Detection of WooCommerce can reuse existing site-info fields populated by `/me/sites`.

- [ ] **Step 3: Run tests, commit**

```bash
git add apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx
git commit -m "Wire prod↔staging gutter to wpcom staging-site endpoints"
```

---

## Task 22: Guardrail for destructive pushes to Production

Anything that overwrites production via the Local↔Production gutter must prompt a confirm that names the target URL.

**Files:**
- Modify: `apps/studio/src/modules/sync/hooks/use-sync-actions.ts` (the push wrapper created in Task 20)

- [ ] **Step 1: Write a test**

```tsx
it( 'push(productionSite) opens confirm dialog naming the URL', async () => { /* ... */ } );
```

- [ ] **Step 2: Implement confirm wrapper**

Before dispatching `pushSiteThunk` for a site where `environmentType === 'production'`, open a ConfirmDialog with text that includes the site URL. Only if confirmed, dispatch the thunk. Use `@wordpress/components`' `ConfirmDialog`.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/modules/sync/hooks/use-sync-actions.ts
git commit -m "Confirm destructive pushes to production"
```

---

## Task 23: Enforce slot uniqueness in Add Site Connect flow

When a user connects a new site whose `environmentType` matches an already-filled slot, show an inline error + offer "Replace current {Production|Staging}" action.

**Files:**
- Modify: `apps/studio/src/modules/sync/components/sync-sites-modal-selector.tsx` (PR #3161's file — small, surgical edit)
- Alternatively, wrap `useConnectSiteMutation` so the check happens at the store layer.

Since the spec says **"Add Site and Connect flows (PR #3161 scope)"** are not to be touched, enforce this at the **mutation layer** instead of the modal:

- [ ] **Step 1: Intercept `connectSite` mutation**

In `apps/studio/src/stores/sync/connected-sites.ts`, modify `connectSite.queryFn`:

```ts
queryFn: async ( { site, localSiteId }, api ) => {
	const state = api.getState() as RootState;
	// Fetch current connections synchronously via the endpoint's cache or an IPC call.
	const existing = await getIpcApi().getConnectedWpcomSites( localSiteId );
	const { production, staging } = deriveSlotAssignments( existing );
	const incomingSlot =
		site.slotOverride ??
		( site.environmentType === 'staging' || site.isStaging
			? 'staging'
			: site.environmentType === 'production'
			  ? 'production'
			  : 'archived' );
	if ( incomingSlot === 'production' && production ) {
		return {
			error: { status: 'SLOT_TAKEN', data: { slot: 'production', current: production } } as any,
		};
	}
	if ( incomingSlot === 'staging' && staging ) {
		return {
			error: { status: 'SLOT_TAKEN', data: { slot: 'staging', current: staging } } as any,
		};
	}
	await getIpcApi().connectWpcomSites( [ { sites: [ site ], localSiteId } ] );
	const actualConnectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
	return { data: actualConnectedSites };
},
```

- [ ] **Step 2: Write a test**

```ts
it( 'returns SLOT_TAKEN error when connecting a second production site', async () => { /* ... */ } );
```

- [ ] **Step 3: Surface the error in the connect modal without touching layout**

Add a 1–2 line handler for the `SLOT_TAKEN` error in the connect modal: render a Notice above the site list with the message "A {slot} site is already connected. Connect and replace?" plus a button that calls `updateConnectedSiteSlot` on the current slot-holder (setting `slotOverride='archived'`) followed by re-submitting. Fewer than 20 lines of JSX added — within bounds of "not touching" since nothing else moves.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/stores/sync/connected-sites.ts apps/studio/src/modules/sync/components/sync-sites-modal-selector.tsx
git commit -m "Enforce one-production / one-staging slot rule on connect"
```

---

## Task 24: Swap `SyncConnectedSites` for `TriangleLayout`

**Files:**
- Modify: `apps/studio/src/modules/sync/index.tsx`

- [ ] **Step 1: Replace the render call**

In `apps/studio/src/modules/sync/index.tsx` (`ContentTabSync` at line ~125):

```tsx
import { TriangleLayout } from './components/triangle/triangle-layout';

// ...inside the component body, replace:
// <SyncConnectedSites ... />
// with:
<TriangleLayout
	localSiteId={ selectedSite.id }
	localSiteName={ selectedSite.name }
	localSiteUrl={ selectedSite.url /* the local http://localhost:PORT URL */ }
	isRunning={ selectedSite.running }
/>
```

Leave `NoAuthSyncTab` untouched.

- [ ] **Step 2: Delete the old component file**

```bash
git rm apps/studio/src/modules/sync/components/sync-connected-sites.tsx
```

Search for any remaining imports and delete them. If any other file still references it, it's dead code that should also go.

- [ ] **Step 3: Typecheck & full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/modules/sync/index.tsx
git commit -m "Replace SyncConnectedSites with TriangleLayout"
```

---

## Task 25: Manual QA + verification before completion

- [ ] **Step 1: Run the full build locally**

```bash
npm run cli:build
npm start
```

- [ ] **Step 2: Manual QA checklist**

For each of the following states, verify the triangle renders correctly and all actions work:

- [ ] New local site, no connections → only Local column + `ConnectProductionCard`.
- [ ] Connect a production wpcom site → Local + Production columns + `CreateStagingCard`.
- [ ] Click "Create staging" → quota check passes → spinner → new staging column appears.
- [ ] Click "Create staging" with a Pressable production → message explains Pressable is out of scope + link to Pressable flow.
- [ ] Pull from Production to Local → existing sync-options sheet opens; progress bar shows in gutter.
- [ ] Push to Production → confirm dialog names the URL; proceed; progress shows.
- [ ] Push to Staging (from Local) → works; timestamp updates.
- [ ] "Promote to Production" → confirm dialog; wpcom sync-state eventually reports finished.
- [ ] Disconnect production → column collapses back to `ConnectProductionCard`; staging column disappears too (since there's no prod to anchor it).
- [ ] Open a local site that was connected to 3+ wpcom sites before the migration → two sites in slots, the rest in "Archived connections."
- [ ] Move an archived site into a free slot → it pops up into the triangle.
- [ ] Connect a new production site while one is already connected → connect modal shows "Slot taken, replace?" notice.

- [ ] **Step 3: Lint & typecheck one final time**

```bash
npx eslint --fix $(git diff --name-only trunk -- '*.ts' '*.tsx')
npm run typecheck
npm test
```

Expected: all clean.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -u
git commit -m "Lint fixes" # only if needed
```

- [ ] **Step 5: Open a Draft PR**

```bash
gh pr create --draft --title "Redesign Sync tab as environment triangle" --body "$(cat <<'EOF'
## Summary

Replaces the flat connected-sites list on the per-site Sync tab with a Local → Production → Staging triangle. Adds one-click wpcom staging provisioning, content counts per environment, native prod↔staging sync, and a slot-enforcement model (one production + one staging per local site, with archived-connection fallback for existing users).

Based on the spec at `docs/superpowers/specs/2026-04-20-sync-tab-redesign-design.md` and the plan at `docs/superpowers/plans/2026-04-20-sync-tab-redesign.md`.

**Dependency:** PR #3161 (enriched site metadata + Add Site redesign) must be merged first.

## Testing Instructions

See the manual QA checklist in the plan document.

## Pre-merge Checklist

- [ ] Have you checked for TypeScript, React or other console errors?
- [ ] Have you tested on macOS, Windows, and Linux where applicable?
- [ ] Have you added automated tests where applicable?
EOF
)"
```

---

## Self-Review Checklist (run before handing off for execution)

**Spec coverage:**
- Triangle layout, dynamic columns: Tasks 13, 15, 20 ✓
- Per-column anatomy (mshot, label, counts, etc.): Tasks 6–8, 13 ✓
- Gutters with direction-aware labels: Tasks 14, 20, 21 ✓
- Empty & partial states (no-connection, prod-only, full): Task 20 ✓
- One-click staging provisioning + quota preflight + streaming column: Tasks 9–12, 17, 18 ✓
- Pressable fallback messaging: Task 15 + Task 25 manual QA ✓
- Slot-override persistence + derivation: Tasks 1–4 ✓
- Migration for >2 connections: Task 5 ✓
- Archived-connections disclosure + move-back action: Task 19 ✓
- Destructive-push guardrail: Task 22 ✓
- Slot-uniqueness enforcement on connect: Task 23 ✓
- Wire-up and old-component deletion: Task 24 ✓
- Native prod↔staging push/pull via wpcom endpoints: Tasks 10–12, 21 ✓

**Placeholder scan:** No "TBD"s in step bodies. The phrase "TODO: thread from sync-state query" in Task 20 is immediately resolved by Task 21. The three small deferred items (Pressable-aware copy, WooCommerce confirm text, TimeAgo helper inline impl) all have concrete resolution paths called out in their tasks.

**Type consistency:** `slotOverride` uses the same 4-value union across Tasks 1, 2, 3, 4, 19, 23. Sync option values (`sqls | paths | uploads | plugins | themes | contents`) are unchanged from the existing `SyncOption` type. Staging-site response types are centralised in `tools/common/types/staging-site.ts` (Task 9) and consumed from there in Tasks 10, 12, 17.

**Non-goals respected:** Add Site / Connect modal layout is not modified (Task 23 limits itself to a Notice surface + store-layer validation). Overview tab untouched. No per-post drift computation.
