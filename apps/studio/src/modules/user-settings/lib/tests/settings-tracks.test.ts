/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import {
	readAiSettings,
	saveAnthropicApiKey as saveAnthropicApiKeyToConfig,
	setAiProvider as setAiProviderInConfig,
} from '@studio/common/ai/settings-store';
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
	saveAnthropicApiKey,
	setAiProvider,
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
vi.mock( '@studio/common/ai/settings-store', () => ( {
	readAiSettings: vi.fn(),
	saveAnthropicApiKey: vi.fn(),
	setAiProvider: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const mockReadAiSettings = vi.mocked( readAiSettings );
const mockSaveAnthropicApiKey = vi.mocked( saveAnthropicApiKeyToConfig );
const mockSetAiProvider = vi.mocked( setAiProviderInConfig );
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

// Both handlers report the resulting state through one event, because clearing the key also moves
// the provider back to WordPress.com. The key never leaves the store — only booleans and the
// provider id are sent.
describe( 'AI provider settings', () => {
	const keyPreview = 'sk-ant-api03-tes...1234';
	const wpcomWithoutKey = {
		provider: 'wpcom',
		hasAnthropicApiKey: false,
		anthropicApiKeyPreview: null,
	} as const;
	const anthropicWithKey = {
		provider: 'anthropic-api-key',
		hasAnthropicApiKey: true,
		anthropicApiKeyPreview: keyPreview,
	} as const;

	it( 'emits studio_setting_ai_provider_change when a key is added', async () => {
		mockReadAiSettings.mockResolvedValue( wpcomWithoutKey );
		mockSaveAnthropicApiKey.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: keyPreview,
		} );

		await saveAnthropicApiKey( event, 'sk-ant-api03-testkey-1234' );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			provider: 'wpcom',
			has_anthropic_api_key: true,
			surface: 'settings',
		} );
	} );

	it( 'never sends the key itself', async () => {
		mockReadAiSettings.mockResolvedValue( wpcomWithoutKey );
		mockSaveAnthropicApiKey.mockResolvedValue( anthropicWithKey );

		await saveAnthropicApiKey( event, 'sk-ant-api03-testkey-1234' );

		const props = JSON.stringify( mockRecord.mock.calls[ 0 ][ 1 ] );
		expect( props ).not.toContain( 'testkey' );
		expect( props ).not.toContain( '1234' );
	} );

	it( 'reports a cleared key falling back to WordPress.com', async () => {
		mockReadAiSettings.mockResolvedValue( anthropicWithKey );
		mockSaveAnthropicApiKey.mockResolvedValue( wpcomWithoutKey );

		await saveAnthropicApiKey( event, null );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			provider: 'wpcom',
			has_anthropic_api_key: false,
			surface: 'settings',
		} );
	} );

	it( 'emits when a saved key is swapped for a different one', async () => {
		mockReadAiSettings.mockResolvedValue( anthropicWithKey );
		mockSaveAnthropicApiKey.mockResolvedValue( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...9999',
		} );

		await saveAnthropicApiKey( event, 'sk-ant-api03-otherkey-9999' );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			provider: 'anthropic-api-key',
			has_anthropic_api_key: true,
			surface: 'settings',
		} );
	} );

	it( 'does not emit when re-saving the same key', async () => {
		mockReadAiSettings.mockResolvedValue( anthropicWithKey );
		mockSaveAnthropicApiKey.mockResolvedValue( anthropicWithKey );

		await saveAnthropicApiKey( event, 'sk-ant-api03-testkey-1234' );

		expect( mockRecord ).not.toHaveBeenCalled();
	} );

	it( 'emits the provider setAiProvider switched to', async () => {
		mockReadAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: keyPreview,
		} );
		mockSetAiProvider.mockResolvedValue( anthropicWithKey );

		await setAiProvider( event, 'anthropic-api-key' );

		expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			provider: 'anthropic-api-key',
			has_anthropic_api_key: true,
			surface: 'settings',
		} );
	} );

	it( 'does not emit when the provider is already selected', async () => {
		mockReadAiSettings.mockResolvedValue( anthropicWithKey );
		mockSetAiProvider.mockResolvedValue( anthropicWithKey );

		await setAiProvider( event, 'anthropic-api-key' );

		expect( mockRecord ).not.toHaveBeenCalled();
	} );
} );
