import { describe, expect, it } from 'vitest';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { deriveOrientationAutostart } from './use-orientation-autostart';
import type { OnboardingHintsState } from '@/data/core';

const base = {
	onboardingCompleted: true,
	siteCount: 1,
	agentic: { enabled: true, isReady: true },
	hints: {} as OnboardingHintsState,
	guideOpen: false,
	alreadyStarted: false,
};

describe( 'deriveOrientationAutostart', () => {
	it( 'opens the agentic guide when everything is ready', () => {
		expect( deriveOrientationAutostart( base ) ).toBe( 'agentic' );
	} );

	it( 'opens the overview guide when agentic features are disabled', () => {
		expect(
			deriveOrientationAutostart( { ...base, agentic: { enabled: false, isReady: true } } )
		).toBe( 'overview' );
	} );

	it( 'waits until the pre-workbench welcome is done', () => {
		expect( deriveOrientationAutostart( { ...base, onboardingCompleted: false } ) ).toBeNull();
		expect( deriveOrientationAutostart( { ...base, onboardingCompleted: undefined } ) ).toBeNull();
	} );

	it( 'waits until there is at least one site', () => {
		expect( deriveOrientationAutostart( { ...base, siteCount: 0 } ) ).toBeNull();
	} );

	it( 'waits until the agentic gate has resolved', () => {
		expect(
			deriveOrientationAutostart( { ...base, agentic: { enabled: true, isReady: false } } )
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
		).toBe( 'agentic' );
	} );

	it( 'does not open while the guide is already open or already started', () => {
		expect( deriveOrientationAutostart( { ...base, guideOpen: true } ) ).toBeNull();
		expect( deriveOrientationAutostart( { ...base, alreadyStarted: true } ) ).toBeNull();
	} );
} );
