import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	readUserPreferences,
	userPreferencesPatchSchema,
	writeUserPreferences,
} from '@studio/common/lib/user-settings/user-preferences';

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

it( 'keeps the sidebar preferences, which default to recent chats shown and sites folding', async () => {
	const context = { sitesRoot: configDir, installedApps: {} as never };
	expect( await readUserPreferences( context ) ).toMatchObject( {
		sidebarChatOrder: {},
		showRecentChats: true,
		autoCollapseSites: true,
	} );

	await writeUserPreferences(
		{
			sidebarChatOrder: { 'site-1': [ 'chat-2', 'chat-1' ] },
			showRecentChats: false,
			autoCollapseSites: false,
		},
		{ sitesRoot: configDir }
	);

	expect( await readUserPreferences( context ) ).toMatchObject( {
		sidebarChatOrder: { 'site-1': [ 'chat-2', 'chat-1' ] },
		showRecentChats: false,
		autoCollapseSites: false,
	} );
} );

it( 'keeps what Add site opens on, choosing a starting point until set', async () => {
	const context = { sitesRoot: configDir, installedApps: {} as never };
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'choose' );

	await writeUserPreferences( { newSiteBehavior: 'blank' }, { sitesRoot: configDir } );
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'blank' );

	await writeUserPreferences( { newSiteBehavior: null }, { sitesRoot: configDir } );
	expect( ( await readUserPreferences( context ) ).newSiteBehavior ).toBe( 'choose' );
} );

it( 'keeps the appearance tint, falling back to the defaults for unset or invalid values', async () => {
	const context = { sitesRoot: configDir, installedApps: {} as never };
	expect( await readUserPreferences( context ) ).toMatchObject( {
		accentColor: '#3858e9',
		tintIntensity: 0,
		contrast: 0,
	} );

	await writeUserPreferences(
		{ accentColor: '#069E08', tintIntensity: 20, contrast: 45 },
		{ sitesRoot: configDir }
	);
	expect( await readUserPreferences( context ) ).toMatchObject( {
		accentColor: '#069e08',
		tintIntensity: 20,
		contrast: 45,
	} );

	writeFileSync(
		path.join( configDir, 'app.json' ),
		JSON.stringify( { accentColor: 'green', tintIntensity: 140, contrast: -1 } )
	);
	expect( await readUserPreferences( context ) ).toMatchObject( {
		accentColor: '#3858e9',
		tintIntensity: 0,
		contrast: 0,
	} );
} );

it( 'rejects an accent color that is not a hex color', () => {
	expect( userPreferencesPatchSchema.safeParse( { accentColor: 'red' } ).success ).toBe( false );
	expect( userPreferencesPatchSchema.safeParse( { tintIntensity: 101 } ).success ).toBe( false );
} );

it( 'persists sidebar sort choices independently of manual arrangements', async () => {
	const context = { sitesRoot: configDir };
	expect( await readUserPreferences( context ) ).toMatchObject( {
		sidebarPinnedSort: 'type',
		sidebarSiteSort: 'manual',
		sidebarChatSort: 'updated',
	} );
	await writeUserPreferences( { sidebarChatOrder: { site: [ 'old', 'new' ] } }, context );
	expect( ( await readUserPreferences( context ) ).sidebarChatSort ).toBe( 'manual' );
	await writeUserPreferences(
		{ sidebarPinnedSort: 'manual', sidebarSiteSort: 'status', sidebarChatSort: 'updated' },
		context
	);
	expect( await readUserPreferences( context ) ).toMatchObject( {
		sidebarPinnedSort: 'manual',
		sidebarSiteSort: 'status',
		sidebarChatSort: 'updated',
		sidebarChatOrder: { site: [ 'old', 'new' ] },
	} );
	await writeUserPreferences(
		{ sidebarPinnedSort: null, sidebarSiteSort: null, sidebarChatSort: null },
		context
	);
	expect( await readUserPreferences( context ) ).toMatchObject( {
		sidebarPinnedSort: 'type',
		sidebarSiteSort: 'manual',
		sidebarChatSort: 'manual',
	} );
} );

it( 'rejects invalid sort choices and recovers invalid stored values', async () => {
	for ( const key of [ 'sidebarPinnedSort', 'sidebarSiteSort', 'sidebarChatSort' ] ) {
		expect( userPreferencesPatchSchema.safeParse( { [ key ]: 'invalid' } ).success ).toBe( false );
	}
	writeFileSync(
		path.join( configDir, 'app.json' ),
		JSON.stringify( {
			sidebarPinnedSort: 'invalid',
			sidebarSiteSort: 'invalid',
			sidebarChatSort: 'invalid',
		} )
	);
	expect( await readUserPreferences( { sitesRoot: configDir } ) ).toMatchObject( {
		sidebarPinnedSort: 'type',
		sidebarSiteSort: 'manual',
		sidebarChatSort: 'updated',
	} );
} );
