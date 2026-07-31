import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveToolbarState } from './derive-toolbar-state';
import type { DeriveToolbarStateOptions } from './derive-toolbar-state';
import type { SyncSite } from '@/data/core';

const NOW = Date.parse( '2026-07-30T12:00:00.000Z' );
const TWO_HOURS_AGO = new Date( NOW - 2 * 60 * 60 * 1000 ).toISOString();

function liveSite( overrides: Partial< SyncSite > = {} ): SyncSite {
	return {
		id: 42,
		localSiteId: 'riff',
		name: 'Riff',
		url: 'https://riff.wordpress.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

function derive( overrides: Partial< DeriveToolbarStateOptions > = {} ) {
	return deriveToolbarState( {
		activity: null,
		agenticEnabled: true,
		agenticReason: null,
		liveSite: undefined,
		isSyncing: false,
		siteRunning: true,
		...overrides,
	} );
}

function findAction( state: ReturnType< typeof deriveToolbarState >, id: string ) {
	return state.actions.find( ( action ) => action.id === id );
}

describe( 'deriveToolbarState', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	describe( 'live-site lifecycle', () => {
		it( '01 · offers Publish, and says nothing, on a never-connected site', () => {
			const state = derive();

			// Nothing to report on a site that has never been anywhere; the
			// Publish button already says what the state is.
			expect( state.status ).toBeNull();
			expect( state.actions ).toHaveLength( 1 );
			expect( state.actions[ 0 ] ).toMatchObject( {
				id: 'publish',
				label: 'Publish',
				variant: 'solid',
				tone: 'brand',
				disabled: false,
			} );
		} );

		it( '02 · offers both directions at once on a connected site', () => {
			const state = derive( { liveSite: liveSite() } );

			expect( state.status ).toMatchObject( { label: 'Never pushed' } );
			// Pull first and quiet, Push second and primary: pull overwrites
			// local work, so it shouldn't be where the eye lands.
			expect( state.actions.map( ( action ) => action.id ) ).toEqual( [ 'pull', 'push' ] );
			expect( state.actions[ 0 ] ).toMatchObject( { variant: 'outline', tone: 'neutral' } );
			expect( state.actions[ 1 ] ).toMatchObject( { variant: 'solid', tone: 'brand' } );
		} );

		it( '03 · reports the last sync and its age', () => {
			vi.useFakeTimers();
			vi.setSystemTime( NOW );
			const state = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( state.status ).toMatchObject( { label: 'Pushed to live', meta: '2h' } );
		} );

		it( '04 · reports upload progress and keeps the action in a busy state', () => {
			const state = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'pending', direction: 'push', phase: 'uploading', progress: 62 },
				isSyncing: true,
			} );

			expect( state.status ).toMatchObject( {
				tone: 'pending',
				label: 'Uploading… 62%',
				progress: 62,
			} );
			// The button stays put rather than vanishing mid-sync — it just
			// spins, so the toolbar never reflows while the user is watching.
			expect( findAction( state, 'push' ) ).toMatchObject( { busy: true, disabled: false } );
			// The other direction can't start while this one holds the runtime.
			expect( findAction( state, 'pull' ) ).toMatchObject( { disabled: true } );
		} );

		it( '05 · holds a success state before decaying back to history', () => {
			const state = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'success', direction: 'push' },
			} );

			expect( state.status ).toMatchObject( {
				tone: 'success',
				label: 'Pushed to live',
				meta: '1s',
			} );
			expect( findAction( state, 'push' ) ).toMatchObject( { busy: false } );
		} );

		it( '06 · carries a failure into the status and leaves the button pressable', () => {
			const state = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'error', direction: 'push', message: 'Backup timed out' },
			} );

			expect( state.status ).toMatchObject( {
				tone: 'error',
				label: 'Push failed',
				detail: 'Backup timed out',
			} );
			// No separate Retry: the button that failed is still right there.
			expect( findAction( state, 'push' ) ).toMatchObject( { label: 'Push', disabled: false } );
		} );
	} );

	describe( 'context and gating', () => {
		it( '07 · names a staging target instead of calling everything "live"', () => {
			vi.useFakeTimers();
			vi.setSystemTime( NOW );
			const { status } = derive( {
				liveSite: liveSite( { isStaging: true, lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( status ).toMatchObject( { label: 'Pushed to Staging', meta: '2h' } );
		} );

		it( '08 · leaves both actions inert while the local server is stopped', () => {
			const state = derive( {
				siteRunning: false,
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			for ( const action of state.actions ) {
				expect( action ).toMatchObject( {
					disabled: true,
					disabledReason: 'Start the site to sync it.',
				} );
			}
		} );

		it( '09 · greys out everything remote when offline', () => {
			const state = derive( {
				agenticEnabled: false,
				agenticReason: 'offline',
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( state.status ).toMatchObject( { label: 'Offline' } );
			expect( findAction( state, 'push' ) ).toMatchObject( {
				disabled: true,
				disabledReason: 'Go online to sync this site.',
			} );
		} );

		it( '10 · falls back to a single log-in button without an account', () => {
			const state = derive( {
				agenticEnabled: false,
				agenticReason: 'signed-out',
			} );

			expect( state.status ).toBeNull();
			expect( state.actions ).toHaveLength( 1 );
			expect( state.actions[ 0 ] ).toMatchObject( {
				id: 'login',
				label: 'Log in',
				disabled: false,
			} );
		} );

		it( '11 · reports a preview publish through the same status', () => {
			const state = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'pending', direction: 'preview' },
				isSyncing: true,
			} );

			expect( state.status ).toMatchObject( { tone: 'pending', label: 'Publishing preview…' } );
			// Not either action's own work, so they wait rather than spinning.
			expect( findAction( state, 'push' ) ).toMatchObject( {
				busy: false,
				disabled: true,
				disabledReason: 'Another sync is already running.',
			} );
		} );
	} );

	describe( 'push phases', () => {
		it( 'labels the export that precedes the upload', () => {
			const { status } = derive( {
				liveSite: liveSite(),
				activity: { kind: 'pending', direction: 'push', phase: 'exporting' },
			} );

			expect( status ).toMatchObject( { tone: 'pending', label: 'Preparing…' } );
			expect( status?.progress ).toBeUndefined();
		} );

		it( 'keeps the last percentage while a stalled upload waits on the network', () => {
			const { status } = derive( {
				liveSite: liveSite(),
				activity: { kind: 'pending', direction: 'push', phase: 'paused', progress: 62 },
			} );

			expect( status ).toMatchObject( { tone: 'warning', label: 'Upload paused', progress: 62 } );
		} );

		it( 'switches to the remote import once the upload finishes', () => {
			const { status } = derive( {
				liveSite: liveSite(),
				activity: { kind: 'pending', direction: 'push', phase: 'importing' },
			} );

			expect( status ).toMatchObject( { label: 'Applying changes…' } );
		} );
	} );

	it( 'lets Publish through while the local server is stopped', () => {
		const state = derive( { siteRunning: false } );

		expect( state.actions[ 0 ] ).toMatchObject( { id: 'publish', disabled: false } );
	} );
} );
