import { describe, expect, it } from 'vitest';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { deriveWhatsNewAutostart } from './use-whats-new-autostart';
import { WHATS_NEW_VERSION } from './whats-new';
import type { OnboardingHintsState } from '@/data/core';

// Someone upgrading: they have a site, went through orientation on an earlier
// release, and haven't seen the current pages.
const base = {
	siteCount: 1,
	agenticReady: true,
	hints: { tourCompletedVersion: ORIENTATION_GUIDE_VERSION } as OnboardingHintsState,
	dialogOpen: false,
	guideOpen: false,
	alreadyStarted: false,
};

describe( 'deriveWhatsNewAutostart', () => {
	it( 'shows the pages to someone upgrading', () => {
		expect( deriveWhatsNewAutostart( base ) ).toBe( 'show' );
		expect(
			deriveWhatsNewAutostart( {
				...base,
				hints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
			} )
		).toBe( 'show' );
	} );

	it( 'shows them again when the pages change', () => {
		expect(
			deriveWhatsNewAutostart( {
				...base,
				hints: { ...base.hints, whatsNewSeenVersion: WHATS_NEW_VERSION - 1 },
			} )
		).toBe( 'show' );
	} );

	it( 'does not show the pages once seen', () => {
		expect(
			deriveWhatsNewAutostart( {
				...base,
				hints: { ...base.hints, whatsNewSeenVersion: WHATS_NEW_VERSION },
			} )
		).toBeNull();
	} );

	it( 'marks them seen without showing on a first run, which gets the orientation guide', () => {
		expect( deriveWhatsNewAutostart( { ...base, hints: {} } ) ).toBe( 'mark-seen' );
	} );

	it( 'waits while Settings or Add site is open', () => {
		expect( deriveWhatsNewAutostart( { ...base, dialogOpen: true } ) ).toBeNull();
	} );

	it( 'waits for a site and for the workspace state to load', () => {
		expect( deriveWhatsNewAutostart( { ...base, siteCount: 0 } ) ).toBeNull();
		expect( deriveWhatsNewAutostart( { ...base, agenticReady: false } ) ).toBeNull();
		expect( deriveWhatsNewAutostart( { ...base, hints: undefined } ) ).toBeNull();
	} );

	it( 'does not open over another guide, or twice in a session', () => {
		expect( deriveWhatsNewAutostart( { ...base, guideOpen: true } ) ).toBeNull();
		expect( deriveWhatsNewAutostart( { ...base, alreadyStarted: true } ) ).toBeNull();
	} );
} );
