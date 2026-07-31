import { describe, expect, it, vi, afterEach } from 'vitest';
import { deriveToolbarState } from './derive-toolbar-state';
import type { DeriveToolbarStateOptions, ToolbarState } from './derive-toolbar-state';
import type { SyncSite } from '@/data/core';

const NOW = Date.parse( '2026-07-30T12:00:00.000Z' );
const TWO_HOURS_AGO = new Date( NOW - 2 * 60 * 60 * 1000 ).toISOString();
const SIX_DAYS_AGO = new Date( NOW - 6 * 24 * 60 * 60 * 1000 ).toISOString();

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
		connections: [],
		isSyncing: false,
		siteRunning: true,
		...overrides,
	} );
}

function action( state: ToolbarState, id: string ) {
	return state.actions.find( ( candidate ) => candidate.id === id );
}

describe( 'deriveToolbarState', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	describe( 'what the site can do', () => {
		it( '01 · offers Publish as the only move on a never-connected site', () => {
			const state = derive();

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
			const state = derive( { connections: [ liveSite() ] } );

			// Pull first and quiet, Push second and primary: pull overwrites
			// local work, so it shouldn't be where the eye lands.
			expect( state.actions.map( ( candidate ) => candidate.id ) ).toEqual( [ 'pull', 'push' ] );
			expect( state.actions[ 0 ] ).toMatchObject( { variant: 'outline', tone: 'neutral' } );
			expect( state.actions[ 1 ] ).toMatchObject( { variant: 'solid', tone: 'brand' } );
		} );

		it( '03 · falls back to a single log-in button without an account', () => {
			const state = derive( { agenticEnabled: false, agenticReason: 'signed-out' } );

			expect( state.actions ).toHaveLength( 1 );
			expect( state.actions[ 0 ] ).toMatchObject( { id: 'login', label: 'Log in' } );
		} );
	} );

	describe( 'what each button says about itself', () => {
		it( '04 · tells each direction when it last ran', () => {
			vi.useFakeTimers();
			vi.setSystemTime( NOW );
			const state = derive( {
				connections: [
					liveSite( { lastPushTimestamp: SIX_DAYS_AGO, lastPullTimestamp: TWO_HOURS_AGO } ),
				],
			} );

			expect( action( state, 'push' ) ).toMatchObject( { hint: 'Last pushed 6d ago' } );
			expect( action( state, 'pull' ) ).toMatchObject( { hint: 'Last pulled 2h ago' } );
		} );

		it( '05 · reads the freshest time across every connection', () => {
			vi.useFakeTimers();
			vi.setSystemTime( NOW );
			const state = derive( {
				connections: [
					liveSite( { id: 1, lastPushTimestamp: SIX_DAYS_AGO } ),
					liveSite( { id: 2, isStaging: true, lastPushTimestamp: TWO_HOURS_AGO } ),
				],
			} );

			expect( action( state, 'push' ) ).toMatchObject( { hint: 'Last pushed 2h ago' } );
		} );

		it( '06 · says so plainly when a direction has never run', () => {
			const state = derive( { connections: [ liveSite() ] } );

			expect( action( state, 'push' ) ).toMatchObject( { hint: 'Never pushed' } );
			expect( action( state, 'pull' ) ).toMatchObject( { hint: 'Never pulled' } );
		} );

		it( '07 · replaces the history with the reason it cannot run', () => {
			const state = derive( { connections: [ liveSite() ], siteRunning: false } );

			for ( const candidate of state.actions ) {
				expect( candidate ).toMatchObject( {
					disabled: true,
					hint: 'Start the site to sync it.',
				} );
			}
		} );

		it( '08 · greys out everything remote when offline', () => {
			const state = derive( {
				agenticEnabled: false,
				agenticReason: 'offline',
				connections: [ liveSite() ],
			} );

			expect( action( state, 'push' ) ).toMatchObject( {
				disabled: true,
				hint: 'Go online to sync this site.',
			} );
		} );

		it( '09 · lets Publish through while the local server is stopped', () => {
			const state = derive( { siteRunning: false } );

			expect( state.actions[ 0 ] ).toMatchObject( { id: 'publish', disabled: false } );
		} );
	} );

	describe( 'work in flight', () => {
		it( '10 · carries real byte progress on the button doing the work', () => {
			const state = derive( {
				connections: [ liveSite() ],
				activity: { kind: 'pending', direction: 'push', phase: 'uploading', progress: 62 },
				isSyncing: true,
			} );

			expect( action( state, 'push' ) ).toMatchObject( {
				busy: true,
				progress: 62,
				// Its own run doesn't block it.
				disabled: false,
			} );
			// The other direction can't start while this one holds the runtime.
			expect( action( state, 'pull' ) ).toMatchObject( {
				disabled: true,
				hint: 'Another sync is already running.',
			} );
		} );

		it( '11 · leaves the fill flat for a phase that cannot report a percentage', () => {
			const state = derive( {
				connections: [ liveSite() ],
				activity: { kind: 'pending', direction: 'push', phase: 'exporting' },
				isSyncing: true,
			} );

			expect( action( state, 'push' ) ).toMatchObject( { busy: true } );
			expect( action( state, 'push' )?.progress ).toBeUndefined();
		} );

		it( '12 · spins neither button for work that is not theirs', () => {
			const state = derive( {
				connections: [ liveSite() ],
				activity: { kind: 'pending', direction: 'preview' },
				isSyncing: true,
			} );

			for ( const candidate of state.actions ) {
				expect( candidate ).toMatchObject( { busy: false, disabled: true } );
			}
		} );

		it( '13 · leaves a failed direction pressable again, and says nothing about it', () => {
			const state = derive( {
				connections: [ liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ) ],
				activity: { kind: 'error', direction: 'push', message: 'Backup timed out' },
			} );

			// Failures are announced as toasts; the button just goes back to
			// offering the same move.
			expect( action( state, 'push' ) ).toMatchObject( {
				label: 'Push',
				busy: false,
				disabled: false,
			} );
		} );
	} );
} );
