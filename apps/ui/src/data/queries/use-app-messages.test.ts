import { describe, expect, it, vi } from 'vitest';
import { deriveUpdateMessages } from './use-app-messages';
import type { AppUpdateStatus } from '@/data/core';

const noop = () => {};

describe( 'deriveUpdateMessages', () => {
	it( 'shows nothing while idle, checking, or before the first status arrives', () => {
		expect( deriveUpdateMessages( undefined, noop ) ).toEqual( [] );
		expect( deriveUpdateMessages( { state: 'idle', currentVersion: '1.20.0' }, noop ) ).toEqual(
			[]
		);
		expect( deriveUpdateMessages( { state: 'checking', currentVersion: '1.20.0' }, noop ) ).toEqual(
			[]
		);
	} );

	it( 'names both versions while downloading', () => {
		const [ message ] = deriveUpdateMessages(
			{ state: 'downloading', currentVersion: '1.20.0', newVersion: '1.21.0' },
			noop
		);

		expect( message.title ).toBe( 'Downloading update' );
		expect( message.description ).toBe( 'Updating from 1.20.0 to 1.21.0.' );
		expect( message.cta ).toBeUndefined();
	} );

	it( 'falls back to the current version when the target is not yet known', () => {
		const [ message ] = deriveUpdateMessages(
			{ state: 'downloading', currentVersion: '1.20.0', newVersion: null },
			noop
		);

		expect( message.description ).toBe( 'Updating from 1.20.0.' );
	} );

	it( 'offers a restart once the update is ready', () => {
		const onInstall = vi.fn();
		const [ message ] = deriveUpdateMessages(
			{ state: 'ready', currentVersion: '1.20.0', newVersion: '1.21.0' },
			onInstall
		);

		expect( message.title ).toBe( 'Studio 1.21.0 is ready to install' );
		expect( message.description ).toBe( 'Updating from 1.20.0 to 1.21.0.' );
		expect( message.id ).toBe( 'app-update:1.21.0' );

		message.cta?.onClick();
		expect( onInstall ).toHaveBeenCalled();
	} );

	it( 'still offers a restart when the updater never named the version', () => {
		const [ message ] = deriveUpdateMessages(
			{ state: 'ready', currentVersion: null, newVersion: null },
			noop
		);

		expect( message.title ).toBe( 'A Studio update is ready to install' );
		expect( message.description ).toBe( 'Restart to finish updating.' );
		expect( message.id ).toBe( 'app-update' );
	} );

	it( 'surfaces updater errors with the reason detail when there is one', () => {
		const status: AppUpdateStatus = {
			state: 'error',
			currentVersion: '1.20.0',
			reason: 'read-only-volume',
			detail: 'Studio is running from a disk image.',
		};

		const [ message ] = deriveUpdateMessages( status, noop );

		expect( message.intent ).toBe( 'error' );
		expect( message.title ).toBe( "Couldn't update Studio" );
		expect( message.description ).toBe( 'Studio is running from a disk image.' );
	} );

	it( 'falls back to generic guidance for an error with no detail', () => {
		const [ message ] = deriveUpdateMessages(
			{ state: 'error', currentVersion: '1.20.0', reason: 'generic' },
			noop
		);

		expect( message.description ).toBe(
			'Studio will try again the next time it checks for updates.'
		);
	} );
} );
