import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	readUserPreferences,
	writeUserPreferences,
} from '@studio/common/lib/user-settings/user-preferences';
import type { InstalledApps } from '@studio/common/lib/user-settings/installed-apps';

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-prefs-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		path.join( configDir, 'app.json' ),
		JSON.stringify( { preferredEditor: 'vscode', colorScheme: 'dark' } )
	);
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'records each preference the patch changes, and only those', async () => {
	const recordTracksEvent = vi.fn().mockResolvedValue( undefined );

	await writeUserPreferences(
		{ editor: 'vscode', colorScheme: 'light', defaultSiteDirectory: configDir },
		{ sitesRoot: configDir, recordTracksEvent }
	);

	expect( recordTracksEvent.mock.calls ).toEqual( [
		[ TRACKS_EVENTS.SETTING_APPEARANCE_CHANGE, { mode: 'light', surface: 'settings' } ],
	] );
} );

it( 'records the analytics toggle while analytics is on', async () => {
	const optedOutWhenRecorded: boolean[] = [];
	const recordTracksEvent = vi.fn( async () => {
		optedOutWhenRecorded.push( !! ( await readSharedConfig() ).analyticsOptOut );
	} );

	await writeUserPreferences(
		{ analyticsEnabled: false, surface: 'onboarding' },
		{ sitesRoot: configDir, recordTracksEvent }
	);
	await writeUserPreferences(
		{ analyticsEnabled: true },
		{ sitesRoot: configDir, recordTracksEvent }
	);

	expect( recordTracksEvent ).toHaveBeenNthCalledWith( 1, TRACKS_EVENTS.SETTING_TELEMETRY_CHANGE, {
		status: 'off',
		surface: 'onboarding',
	} );
	expect( optedOutWhenRecorded ).toEqual( [ false, false ] );
} );

it( 'keeps what Add site opens on, choosing a starting point until set', async () => {
	const context = { sitesRoot: configDir, installedApps: {} as InstalledApps };
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'choose' );

	await writeUserPreferences( { newSiteBehavior: 'blank' }, { sitesRoot: configDir } );
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'blank' );

	await writeUserPreferences( { newSiteBehavior: null }, { sitesRoot: configDir } );
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'choose' );
} );
