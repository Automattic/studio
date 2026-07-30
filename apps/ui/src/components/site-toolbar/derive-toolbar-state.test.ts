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
		direction: 'push',
		agenticEnabled: true,
		agenticReason: null,
		liveSite: undefined,
		isSyncing: false,
		siteRunning: true,
		...overrides,
	} );
}

describe( 'deriveToolbarState', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	describe( 'live-site lifecycle', () => {
		it( '01 · offers Publish, and says nothing, on a never-connected site', () => {
			const { status, action } = derive();

			// Nothing to report on a site that has never been anywhere; the
			// Publish button already says what the state is.
			expect( status ).toBeNull();
			expect( action ).toMatchObject( {
				id: 'publish',
				label: 'Publish',
				variant: 'solid',
				tone: 'brand',
				disabled: false,
			} );
		} );

		it( '02 · keeps Push primary until the first one lands', () => {
			const { status, action } = derive( { liveSite: liveSite() } );

			expect( status ).toMatchObject( { label: 'Never pushed' } );
			expect( action ).toMatchObject( {
				id: 'push',
				variant: 'solid',
				tone: 'brand',
			} );
		} );

		it( '03 · keeps Push solid once there is history', () => {
			vi.useFakeTimers();
			vi.setSystemTime( NOW );
			const { status, action } = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( status ).toMatchObject( { label: 'Pushed to live', meta: '2h' } );
			expect( action ).toMatchObject( { id: 'push', variant: 'solid', tone: 'brand' } );
		} );

		it( '04 · reports upload progress and keeps the action in a busy state', () => {
			const { status, action } = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'pending', direction: 'push', phase: 'uploading', progress: 62 },
				isSyncing: true,
			} );

			expect( status ).toMatchObject( { tone: 'pending', label: 'Uploading… 62%', progress: 62 } );
			// The button stays put rather than vanishing mid-sync — it just
			// spins, so the toolbar never reflows while the user is watching.
			expect( action ).toMatchObject( { id: 'push', busy: true, disabled: false } );
		} );

		it( '05 · holds a success state before decaying back to history', () => {
			const { status, action } = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'success', direction: 'push' },
			} );

			expect( status ).toMatchObject( {
				tone: 'success',
				label: 'Pushed to live',
				meta: '1s',
			} );
			expect( action ).toMatchObject( { id: 'push', busy: false } );
		} );

		it( '06 · promotes Retry and carries the error message into the detail', () => {
			const { status, action } = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'error', direction: 'push', message: 'Backup timed out' },
			} );

			expect( status ).toMatchObject( {
				tone: 'error',
				label: 'Push failed',
				detail: 'Backup timed out',
			} );
			expect( action ).toMatchObject( { id: 'retry', label: 'Retry', disabled: false } );
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

		it( '08 · leaves the action inert while the local server is stopped', () => {
			const { action } = derive( {
				siteRunning: false,
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( action ).toMatchObject( {
				disabled: true,
				disabledReason: 'Start the site to sync it.',
			} );
		} );

		it( '09 · greys out everything remote when offline', () => {
			const { status, action } = derive( {
				agenticEnabled: false,
				agenticReason: 'offline',
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
			} );

			expect( status ).toMatchObject( { label: 'Offline' } );
			expect( action ).toMatchObject( {
				disabled: true,
				disabledReason: 'Go online to sync this site.',
			} );
		} );

		it( '10 · falls back to a sign-in prompt without an account', () => {
			const { status, action } = derive( {
				agenticEnabled: false,
				agenticReason: 'signed-out',
			} );

			expect( status ).toMatchObject( { label: 'Sign in to publish' } );
			expect( action ).toMatchObject( { id: 'login', label: 'Log in', disabled: false } );
		} );

		it( '11 · reports a preview publish through the same pill', () => {
			const { status, action } = derive( {
				liveSite: liveSite( { lastPushTimestamp: TWO_HOURS_AGO } ),
				activity: { kind: 'pending', direction: 'preview' },
				isSyncing: true,
			} );

			expect( status ).toMatchObject( { tone: 'pending', label: 'Publishing preview…' } );
			// Not this action's own work, so it waits rather than spinning.
			expect( action ).toMatchObject( {
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
		const { action } = derive( { siteRunning: false } );

		expect( action ).toMatchObject( { id: 'publish', disabled: false } );
	} );
} );
