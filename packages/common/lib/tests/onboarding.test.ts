import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import {
	initializeWalkthrough,
	readOnboardingCompleted,
	writeOnboardingCompleted,
} from '@studio/common/lib/user-settings/onboarding';
import {
	readOnboardingHints,
	writeOnboardingHints,
} from '@studio/common/lib/user-settings/user-preferences';

let configDir: string;
beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-onboarding-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
} );
afterEach( () => {
	vi.unstubAllEnvs();
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'persists completion without losing unrelated preferences or legacy tour state', async () => {
	await updateConfig( ( { preferences } ) => {
		preferences.colorScheme = 'dark';
		preferences.onboardingHints = { tourCompletedVersion: 2 };
	} );
	expect( await readOnboardingCompleted() ).toBe( false );
	expect( await writeOnboardingCompleted( true ) ).toBe( true );
	expect( await readOnboardingCompleted() ).toBe( true );
	expect( await writeOnboardingCompleted( true ) ).toBe( false );
	expect( ( await readConfig() ).preferences ).toMatchObject( {
		colorScheme: 'dark',
		onboardingHints: { tourCompletedVersion: 2 },
		onboardingCompleted: true,
	} );
} );

it( 'reports only one completion when hosts save concurrently', async () => {
	const completed = await Promise.all( [
		writeOnboardingCompleted( true ),
		writeOnboardingCompleted( true ),
	] );
	expect( completed.filter( Boolean ) ).toHaveLength( 1 );
} );

it( 'persists the annotation hint without losing other tips or guide progress', async () => {
	await writeOnboardingHints( {
		tourCompletedVersion: 2,
		whatsNewSeenVersion: 3,
		walkthroughStep: 'composer',
		shareHintDismissed: true,
	} );
	await writeOnboardingHints( { annotateHintDismissed: true } );
	expect( await readOnboardingHints() ).toMatchObject( {
		tourCompletedVersion: 2,
		whatsNewSeenVersion: 3,
		walkthroughStep: 'composer',
		shareHintDismissed: true,
		annotateHintDismissed: true,
	} );
} );

it( 'enrolls a fresh profile and preserves progress across hosts', async () => {
	await Promise.all( [ initializeWalkthrough(), initializeWalkthrough() ] );
	expect( await readOnboardingHints() ).toMatchObject( { walkthroughStep: 'create' } );
	await writeOnboardingHints( { walkthroughStep: 'share' } );
	await initializeWalkthrough();
	expect( await readOnboardingHints() ).toMatchObject( { walkthroughStep: 'share' } );
} );

it( 'persists the existing-site introduction across hosts', async () => {
	await writeOnboardingHints( { walkthroughStep: 'intro', annotateHintDismissed: false } );
	await initializeWalkthrough();
	expect( await readOnboardingHints() ).toMatchObject( {
		walkthroughStep: 'intro',
		annotateHintDismissed: false,
	} );
} );

it.each( [
	{ onboardingCompleted: true },
	{ onboardingHints: { tourCompletedVersion: 1 } },
	{ onboardingHints: { tourDismissedVersion: 1 } },
	{ onboardingHints: { migratedFromClassic: true } },
	{ onboardingHints: { whatsNewSeenVersion: 1 } },
] )( 'excludes prior users with no sites: %j', async ( prior ) => {
	await updateConfig( ( config ) => Object.assign( config.preferences, prior ) );
	await initializeWalkthrough();
	expect( await readOnboardingHints() ).toMatchObject( { walkthroughStep: 'ineligible' } );
} );

it( 'excludes users with existing CLI sites', async () => {
	await updateConfig( ( config ) => { config.sites.push( { id: 'existing', name: 'Existing', path: '/sites/existing', port: 8881, phpVersion: '8.3' } ); } );
	await initializeWalkthrough();
	expect( await readOnboardingHints() ).toMatchObject( { walkthroughStep: 'ineligible' } );
} );

it.each( [ 'completed', 'skipped', 'ineligible' ] as const )(
	'does not re-enroll a %s walkthrough',
	async ( walkthroughStep ) => {
		await writeOnboardingHints( { walkthroughStep } );
		await initializeWalkthrough();
		expect( await readOnboardingHints() ).toMatchObject( { walkthroughStep } );
	}
);
