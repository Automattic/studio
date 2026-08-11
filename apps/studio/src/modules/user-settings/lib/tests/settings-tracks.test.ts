/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { writeGlobalInstructions } from '@studio/common/ai/global-instructions';
import { readSharedConfig, updateSharedConfig } from '@studio/common/lib/shared-config';
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
	saveGlobalAgentInstructions,
} from 'src/modules/user-settings/lib/ipc-handlers';
import { defaultSitePath } from 'src/storage/paths';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

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
	readSharedConfig: vi.fn(),
	updateSharedConfig: vi.fn(),
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
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
vi.mock( '@studio/common/ai/global-instructions', () => ( {
	readGlobalInstructionsFile: vi.fn(),
	writeGlobalInstructions: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const mockLoadUserData = vi.mocked( loadUserData );
const mockReadSharedConfig = vi.mocked( readSharedConfig );
const event = {} as IpcMainInvokeEvent;

// The persisted appdata / shared-config the handler reads to detect a real change.
function setPersisted( userData: Record< string, unknown > = {} ) {
	mockLoadUserData.mockResolvedValue(
		userData as unknown as Awaited< ReturnType< typeof loadUserData > >
	);
}
function setPersistedLocale( locale?: string ) {
	mockReadSharedConfig.mockResolvedValue( {
		locale,
	} as unknown as Awaited< ReturnType< typeof readSharedConfig > > );
}

beforeEach( () => {
	vi.clearAllMocks();
	setPersisted();
	setPersistedLocale();
} );

it( 'saveColorScheme emits studio_setting_appearance_change with mode + surface when the mode changes', async () => {
	setPersisted( { colorScheme: 'light' } );

	await saveColorScheme( event, 'dark' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_APPEARANCE_CHANGE, {
		mode: 'dark',
		surface: 'settings',
	} );
	expect( updateAppdata ).toHaveBeenCalledWith( { colorScheme: 'dark' } );
} );

it( 'saveColorScheme does not emit when the mode is unchanged (persisted default is light)', async () => {
	setPersisted( {} );

	await saveColorScheme( event, 'light' );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( updateAppdata ).toHaveBeenCalledWith( { colorScheme: 'light' } );
} );

it( 'saveUserLocale emits studio_setting_language_change with locale + surface when the locale changes', async () => {
	setPersistedLocale( 'en' );

	await saveUserLocale( event, 'fr' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_LANGUAGE_CHANGE, {
		locale: 'fr',
		surface: 'settings',
	} );
	expect( updateSharedConfig ).toHaveBeenCalledWith( { locale: 'fr' } );
} );

it( 'saveUserLocale does not emit when the locale is unchanged', async () => {
	setPersistedLocale( 'pl' );

	await saveUserLocale( event, 'pl' );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( updateSharedConfig ).toHaveBeenCalledWith( { locale: 'pl' } );
} );

it( 'saveUserEditor emits studio_setting_code_editor_change with editor + surface when the editor changes', async () => {
	setPersisted( { preferredEditor: 'cursor' } );

	await saveUserEditor( event, 'vscode' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_CODE_EDITOR_CHANGE, {
		editor: 'vscode',
		surface: 'settings',
	} );
} );

it( 'saveUserEditor does not emit when the editor is unchanged', async () => {
	setPersisted( { preferredEditor: 'vscode' } );

	await saveUserEditor( event, 'vscode' );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

it( 'saveUserTerminal emits studio_setting_terminal_change with terminal + surface when the terminal changes', async () => {
	setPersisted( { preferredTerminal: 'terminal' } );

	await saveUserTerminal( event, 'iterm' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_TERMINAL_CHANGE, {
		terminal: 'iterm',
		surface: 'settings',
	} );
} );

it( 'saveUserTerminal does not emit when the terminal is unchanged', async () => {
	setPersisted( { preferredTerminal: 'iterm' } );

	await saveUserTerminal( event, 'iterm' );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

it( 'saveDefaultSiteDirectory emits is_default true when set to the default path, and never the path itself', async () => {
	setPersisted( { defaultSiteDirectory: '/home/user/Elsewhere' } );

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
	setPersisted( { defaultSiteDirectory: defaultSitePath } );

	await saveDefaultSiteDirectory( event, '/home/user/Elsewhere' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_DEFAULT_DIRECTORY_CHANGE, {
		is_default: false,
		surface: 'settings',
	} );
} );

it( 'saveDefaultSiteDirectory does not emit when the directory is unchanged', async () => {
	setPersisted( { defaultSiteDirectory: '/home/user/Elsewhere' } );

	await saveDefaultSiteDirectory( event, '/home/user/Elsewhere' );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

it( 'saveQuitSitesBehavior emits studio_setting_quit_action_change with behavior + surface when it changes', async () => {
	setPersisted( { quitSitesBehavior: 'stop' } );

	await saveQuitSitesBehavior( event, 'leave-running' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_QUIT_ACTION_CHANGE, {
		behavior: 'leave-running',
		surface: 'settings',
	} );
} );

it( 'saveQuitSitesBehavior does not emit when the behavior is unchanged', async () => {
	setPersisted( { quitSitesBehavior: 'leave-running' } );

	await saveQuitSitesBehavior( event, 'leave-running' );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

it( 'saveQuitSitesBehavior does not emit when the behavior is cleared', async () => {
	await saveQuitSitesBehavior( event, undefined );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( updateAppdata ).toHaveBeenCalledWith( { quitSitesBehavior: undefined } );
} );

it( 'saveAgenticFeaturesEnabled emits studio_setting_agentic_features_change with enabled + surface when it changes', async () => {
	setPersisted( { agenticFeaturesEnabled: true } );

	await saveAgenticFeaturesEnabled( event, false );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AGENTIC_FEATURES_CHANGE, {
		enabled: false,
		surface: 'settings',
	} );
} );

it( 'saveAgenticFeaturesEnabled does not emit when unchanged (persisted default is true)', async () => {
	setPersisted( {} );

	await saveAgenticFeaturesEnabled( event, true );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

// The instructions save is a special case in this family: the agentic UI autosaves on a debounce, so
// by the time the user leaves the tab the file already holds the new text and Main has nothing to
// compare against. The renderer therefore supplies the value the edit session started from, and
// intermediate autosaves omit it entirely so one edit is counted once.
describe( 'saveGlobalAgentInstructions', () => {
	it( 'emits studio_setting_instructions_change when an edit session changed the text', async () => {
		await saveGlobalAgentInstructions( event, 'Always answer in French.', {
			editSession: { previousContent: '' },
		} );

		expect( writeGlobalInstructions ).toHaveBeenCalledWith( 'Always answer in French.' );
		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_INSTRUCTIONS_CHANGE, {
			has_content: true,
			length_bucket: 'short',
			surface: 'settings',
		} );
	} );

	it( 'does not emit for an intermediate autosave', async () => {
		await saveGlobalAgentInstructions( event, 'Half-typed instr' );

		expect( writeGlobalInstructions ).toHaveBeenCalledWith( 'Half-typed instr' );
		expect( mockRecord ).not.toHaveBeenCalled();
	} );

	it( 'does not emit when the edit session ended with the text unchanged', async () => {
		await saveGlobalAgentInstructions( event, 'Same text', {
			editSession: { previousContent: 'Same text' },
		} );

		expect( mockRecord ).not.toHaveBeenCalled();
	} );

	it( 'reports cleared instructions as empty rather than skipping the change', async () => {
		await saveGlobalAgentInstructions( event, '', {
			editSession: { previousContent: 'Previously set' },
		} );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_INSTRUCTIONS_CHANGE, {
			has_content: false,
			length_bucket: 'empty',
			surface: 'settings',
		} );
	} );

	it( 'buckets length instead of sending the instructions text', async () => {
		await saveGlobalAgentInstructions( event, 'x'.repeat( 1500 ), {
			editSession: { previousContent: '' },
		} );

		const props = mockRecord.mock.calls[ 0 ][ 1 ] as Record< string, unknown >;
		expect( props.length_bucket ).toBe( 'long' );
		expect( JSON.stringify( props ) ).not.toContain( 'xxx' );
	} );

	it( 'treats whitespace-only instructions as empty', async () => {
		await saveGlobalAgentInstructions( event, '   \n  ', {
			editSession: { previousContent: 'Previously set' },
		} );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_INSTRUCTIONS_CHANGE, {
			has_content: false,
			length_bucket: 'empty',
			surface: 'settings',
		} );
	} );
} );
