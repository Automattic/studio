/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { updateSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import {
	saveColorScheme,
	saveUserLocale,
	saveUserEditor,
	saveUserTerminal,
	saveDefaultSiteDirectory,
	saveQuitSitesBehavior,
	saveAgenticFeaturesEnabled,
} from 'src/modules/user-settings/lib/ipc-handlers';
import { defaultSitePath } from 'src/storage/paths';
import { updateAppdata } from 'src/storage/user-data';

vi.mock( 'electron', () => ( {
	BrowserWindow: { fromWebContents: vi.fn() },
	nativeTheme: {},
} ) );
vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	isAnalyticsOptedOut: vi.fn(),
	updateSharedConfig: vi.fn(),
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	updateAppdata: vi.fn(),
} ) );
vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: vi.fn(),
	sendIpcEventToRendererWithWindow: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	defaultSitePath: '/home/user/Studio',
	ensureWritableDirectory: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const event = {} as IpcMainInvokeEvent;

beforeEach( () => {
	vi.clearAllMocks();
} );

it( 'saveColorScheme emits studio_setting_appearance_change with mode + surface', async () => {
	await saveColorScheme( event, 'dark' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_APPEARANCE_CHANGE, {
		mode: 'dark',
		surface: 'settings',
	} );
	expect( updateAppdata ).toHaveBeenCalledWith( { colorScheme: 'dark' } );
} );

it( 'saveUserLocale emits studio_setting_language_change with locale + surface', async () => {
	await saveUserLocale( event, 'fr' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_LANGUAGE_CHANGE, {
		locale: 'fr',
		surface: 'settings',
	} );
	expect( updateSharedConfig ).toHaveBeenCalledWith( { locale: 'fr' } );
} );

it( 'saveUserEditor emits studio_setting_code_editor_change with editor + surface', async () => {
	await saveUserEditor( event, 'vscode' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_CODE_EDITOR_CHANGE, {
		editor: 'vscode',
		surface: 'settings',
	} );
} );

it( 'saveUserTerminal emits studio_setting_terminal_change with terminal + surface', async () => {
	await saveUserTerminal( event, 'iterm' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_TERMINAL_CHANGE, {
		terminal: 'iterm',
		surface: 'settings',
	} );
} );

it( 'saveDefaultSiteDirectory emits is_default true when the directory is the default path, and never the path itself', async () => {
	await saveDefaultSiteDirectory( event, defaultSitePath );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_DEFAULT_DIRECTORY_CHANGE, {
		is_default: true,
		surface: 'settings',
	} );
	const props = mockRecord.mock.calls[ 0 ][ 1 ] as Record< string, unknown >;
	expect( props ).not.toHaveProperty( 'directory' );
	expect( JSON.stringify( props ) ).not.toContain( defaultSitePath );
} );

it( 'saveDefaultSiteDirectory emits is_default false for a custom directory', async () => {
	await saveDefaultSiteDirectory( event, '/home/user/Elsewhere' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_DEFAULT_DIRECTORY_CHANGE, {
		is_default: false,
		surface: 'settings',
	} );
} );

it( 'saveQuitSitesBehavior emits studio_setting_quit_action_change with behavior + surface', async () => {
	await saveQuitSitesBehavior( event, 'leave-running' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_QUIT_ACTION_CHANGE, {
		behavior: 'leave-running',
		surface: 'settings',
	} );
} );

it( 'saveQuitSitesBehavior does not emit when the behavior is cleared', async () => {
	await saveQuitSitesBehavior( event, undefined );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( updateAppdata ).toHaveBeenCalledWith( { quitSitesBehavior: undefined } );
} );

it( 'saveAgenticFeaturesEnabled emits studio_setting_agentic_features_change with enabled + surface', async () => {
	await saveAgenticFeaturesEnabled( event, false );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AGENTIC_FEATURES_CHANGE, {
		enabled: false,
		surface: 'settings',
	} );
} );
