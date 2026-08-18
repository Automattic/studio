import { FORCE_SHOW_WHATS_NEW } from '@studio/common/lib/whats-new';
import { describe, expect, it } from 'vitest';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { deriveWhatsNewAutostart } from './use-whats-new-autostart';
import type { OnboardingHintsState } from '@/data/core';

// Everything ready, the user has been through orientation, and they have never
// dismissed the announcements — the state in which they actually open.
const base = {
	siteCount: 1,
	hints: { tourCompletedVersion: ORIENTATION_GUIDE_VERSION } as OnboardingHintsState,
	lastSeenVersion: null,
	currentVersion: '1.17.0',
	guideOpen: false,
	alreadyStarted: false,
};

describe( 'deriveWhatsNewAutostart', () => {
	it( 'shows the announcements to someone who has never dismissed them', () => {
		expect( deriveWhatsNewAutostart( base ) ).toBe( 'show' );
	} );

	it( 'shows them when orientation was skipped rather than completed', () => {
		expect(
			deriveWhatsNewAutostart( {
				...base,
				hints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
			} )
		).toBe( 'show' );
	} );

	it( 'banks the version without showing when orientation has not run yet', () => {
		// A first-run user gets the orientation guide instead; nothing here is news
		// to them, and two modals in a row is worse than none.
		expect( deriveWhatsNewAutostart( { ...base, hints: {} } ) ).toBe( 'mark-seen' );
	} );

	it( 'banks the version when orientation itself was bumped and is about to re-run', () => {
		expect(
			deriveWhatsNewAutostart( {
				...base,
				hints: { tourCompletedVersion: ORIENTATION_GUIDE_VERSION - 1 },
			} )
		).toBe( 'mark-seen' );
	} );

	it( 'waits until there is at least one site', () => {
		expect( deriveWhatsNewAutostart( { ...base, siteCount: 0 } ) ).toBeNull();
	} );

	it( 'waits until hints and the stored version have loaded', () => {
		expect( deriveWhatsNewAutostart( { ...base, hints: undefined } ) ).toBeNull();
		expect( deriveWhatsNewAutostart( { ...base, lastSeenVersion: undefined } ) ).toBeNull();
	} );

	it( 'does not re-show once the announcements have been dismissed', () => {
		expect( deriveWhatsNewAutostart( { ...base, lastSeenVersion: '1.17.0' } ) ).toBeNull();
	} );

	it( 'follows FORCE_SHOW_WHATS_NEW on an app version the user has not seen', () => {
		// The switch is the release lever: a version bump alone never re-shows the
		// modal, so this tracks the constant rather than asserting one branch.
		expect( deriveWhatsNewAutostart( { ...base, lastSeenVersion: '1.16.0' } ) ).toBe(
			FORCE_SHOW_WHATS_NEW ? 'show' : null
		);
	} );

	it( 'does not open while a guide is already open or already started', () => {
		expect( deriveWhatsNewAutostart( { ...base, guideOpen: true } ) ).toBeNull();
		expect( deriveWhatsNewAutostart( { ...base, alreadyStarted: true } ) ).toBeNull();
	} );
} );
