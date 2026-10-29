import { describe, expect, it, vi } from 'vitest';
import { deriveUpdateMessages } from './use-app-messages';
import type { AppUpdateStatus } from '@/data/core';

describe( 'deriveUpdateMessages', () => {
	it( 'shows nothing while idle, checking, or before the first status arrives', () => {
		expect( deriveUpdateMessages( undefined ) ).toEqual( [] );
		expect( deriveUpdateMessages( { state: 'idle', currentVersion: '1.20.0' } ) ).toEqual( [] );
		expect( deriveUpdateMessages( { state: 'checking', currentVersion: '1.20.0' } ) ).toEqual( [] );
	} );

	it( 'names both versions while downloading', () => {
		const [ message ] = deriveUpdateMessages( {
			state: 'downloading',
			currentVersion: '1.20.0',
			newVersion: '1.21.0',
		} );

		expect( message.title ).toBe( 'Downloading update' );
		expect( message.description ).toBe( 'Updating from 1.20.0 to 1.21.0.' );
		expect( message.action ).toBeUndefined();
	} );

	it( 'falls back to the current version when the target is not yet known', () => {
		const [ message ] = deriveUpdateMessages( {
			state: 'downloading',
			currentVersion: '1.20.0',
			newVersion: null,
		} );

		expect( message.description ).toBe( 'Updating from 1.20.0.' );
	} );

	it.each( [ '1.21.0', null ] )(
		'leaves ready updates to the update button (%s)',
		( newVersion ) => {
			expect(
				deriveUpdateMessages( { state: 'ready', currentVersion: '1.20.0', newVersion } )
			).toEqual( [] );
		}
	);

	it( 'surfaces updater errors with the reason detail when there is one', () => {
		const status: AppUpdateStatus = {
			state: 'error',
			currentVersion: '1.20.0',
			reason: 'read-only-volume',
			detail: 'WordPress Studio is running from a disk image.',
		};

		const onOpenLogs = vi.fn();
		const [ message ] = deriveUpdateMessages( status, {
			label: 'Open logs',
			onClick: onOpenLogs,
		} );

		expect( message.intent ).toBe( 'error' );
		expect( message.title ).toBe( 'Couldn’t update Studio' );
		expect( message.description ).toBe( 'WordPress Studio is running from a disk image.' );
		expect( message.action?.label ).toBe( 'Open logs' );
		void message.action?.onClick();
		expect( onOpenLogs ).toHaveBeenCalledOnce();
	} );

	it( 'falls back to generic guidance for an error with no detail', () => {
		const [ message ] = deriveUpdateMessages( {
			state: 'error',
			currentVersion: '1.20.0',
			reason: 'generic',
		} );

		expect( message.description ).toBe( 'We’ll try again the next time we check for updates.' );
	} );
} );
