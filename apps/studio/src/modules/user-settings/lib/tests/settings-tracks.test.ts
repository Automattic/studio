/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { writeGlobalInstructions } from '@studio/agent/node/global-instructions';
import {
	readAiSettings,
	saveAnthropicApiKey as saveAnthropicApiKeyToConfig,
} from '@studio/agent/node/settings-store';
import { vi } from 'vitest';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import {
	saveGlobalAgentInstructions,
	saveAnthropicApiKey,
} from 'src/modules/user-settings/lib/ipc-handlers';

vi.mock( 'electron', () => ( {
	BrowserWindow: { fromWebContents: vi.fn() },
	nativeTheme: {},
	systemPreferences: { setUserDefault: vi.fn() },
} ) );
vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/agent/node/global-instructions', () => ( {
	readGlobalInstructionsFile: vi.fn(),
	writeGlobalInstructions: vi.fn(),
} ) );
vi.mock( '@studio/agent/node/settings-store', () => ( {
	readAiSettings: vi.fn(),
	saveAnthropicApiKey: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const mockReadAiSettings = vi.mocked( readAiSettings );
const mockSaveAnthropicApiKey = vi.mocked( saveAnthropicApiKeyToConfig );
const event = {} as IpcMainInvokeEvent;

beforeEach( () => {
	vi.clearAllMocks();
} );

// Special case in this family: the agentic UI autosaves on a debounce, so Main has nothing to
// compare against and the renderer supplies the value the edit session started from.
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

// One event for both handlers: clearing the key also moves the provider back to WordPress.com.
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
} );
