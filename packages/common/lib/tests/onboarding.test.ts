import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import {
	readOnboardingCompleted,
	readUsageNoticePending,
	writeOnboardingCompleted,
	writeUsageNoticeSeen,
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

it( 'persists hints without losing guide progress or older fields', async () => {
	await writeOnboardingHints( {
		tourCompletedVersion: 2,
		whatsNewSeenVersion: 3,
		shareHintDismissed: true,
	} );
	await writeOnboardingHints( { annotateHintDismissed: true } );
	expect( await readOnboardingHints() ).toMatchObject( {
		tourCompletedVersion: 2,
		whatsNewSeenVersion: 3,
		shareHintDismissed: true,
		annotateHintDismissed: true,
	} );
} );

it( 'marks the usage notice seen when onboarding completes, so new users never get the notice', async () => {
	expect( await readUsageNoticePending() ).toBe( false );
	await writeOnboardingCompleted( true );
	expect( ( await readConfig() ).preferences.usageNoticeSeen ).toBe( true );
	expect( await readUsageNoticePending() ).toBe( false );
} );

it( 'shows the usage notice once to people onboarded before it existed', async () => {
	await updateConfig( ( { preferences } ) => {
		preferences.onboardingCompleted = true;
	} );
	expect( await readUsageNoticePending() ).toBe( true );
	await writeOnboardingCompleted( true );
	expect( await readUsageNoticePending() ).toBe( true );
	await writeUsageNoticeSeen();
	expect( await readUsageNoticePending() ).toBe( false );
} );
