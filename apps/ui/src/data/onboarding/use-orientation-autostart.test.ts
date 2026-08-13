import { describe, expect, it } from 'vitest';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { deriveOrientationAutostart } from './use-orientation-autostart';
import type { OnboardingHintsState } from '@/data/core';

const base = {
	siteCount: 1,
	agentic: { chatEnabled: true, isReady: true },
	hints: {} as OnboardingHintsState,
	guideOpen: false,
	alreadyStarted: false,
};

describe( 'deriveOrientationAutostart', () => {
	it( 'opens the chat guide for a fresh install when everything is ready', () => {
		expect( deriveOrientationAutostart( base ) ).toEqual( { migrating: false, chatEnabled: true } );
	} );

	it( 'marks the non-chat variant when chat is unavailable (signed out, offline, or opted out)', () => {
		expect(
			deriveOrientationAutostart( { ...base, agentic: { chatEnabled: false, isReady: true } } )
		).toEqual( { migrating: false, chatEnabled: false } );
	} );

	it( 'marks the migrating variant when the user opted in from classic', () => {
		expect(
			deriveOrientationAutostart( { ...base, hints: { migratedFromClassic: true } } )
		).toEqual( { migrating: true, chatEnabled: true } );
	} );

	it( 'waits until there is at least one site', () => {
		expect( deriveOrientationAutostart( { ...base, siteCount: 0 } ) ).toBeNull();
	} );

	it( 'waits until the agentic gate has resolved', () => {
		expect(
			deriveOrientationAutostart( { ...base, agentic: { chatEnabled: true, isReady: false } } )
		).toBeNull();
	} );

	it( 'waits until hints have loaded', () => {
		expect( deriveOrientationAutostart( { ...base, hints: undefined } ) ).toBeNull();
	} );

	it( 'does not re-open a completed guide of the current version', () => {
		expect(
			deriveOrientationAutostart( {
				...base,
				hints: { tourCompletedVersion: ORIENTATION_GUIDE_VERSION },
			} )
		).toBeNull();
	} );

	it( 'does not re-open a dismissed guide of the current version', () => {
		expect(
			deriveOrientationAutostart( {
				...base,
				hints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
			} )
		).toBeNull();
	} );

	it( 're-arms when the guide version is bumped past the seen version', () => {
		expect(
			deriveOrientationAutostart( {
				...base,
				hints: { tourCompletedVersion: ORIENTATION_GUIDE_VERSION - 1 },
			} )
		).toEqual( { migrating: false, chatEnabled: true } );
	} );

	it( 'does not open while the guide is already open or already started', () => {
		expect( deriveOrientationAutostart( { ...base, guideOpen: true } ) ).toBeNull();
		expect( deriveOrientationAutostart( { ...base, alreadyStarted: true } ) ).toBeNull();
	} );
} );
