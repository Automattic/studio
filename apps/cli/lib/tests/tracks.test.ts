import { __recordTracksEvent, TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	getOrCreateAnalyticsInstallId,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { getTracksOrigin, recordTracksEvent } from 'cli/lib/tracks';

vi.mock( '@studio/common/lib/record-tracks-event', async ( importActual ) => {
	const actual = await importActual< typeof import('@studio/common/lib/record-tracks-event') >();
	return { ...actual, __recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	getOrCreateAnalyticsInstallId: vi.fn(),
	isAnalyticsOptedOut: vi.fn(),
	isAutomatticianFromToken: vi.fn(),
} ) );

const mockRecord = vi.mocked( __recordTracksEvent );
const mockInstallId = vi.mocked( getOrCreateAnalyticsInstallId );
const mockOptedOut = vi.mocked( isAnalyticsOptedOut );
const mockIsA11n = vi.mocked( isAutomatticianFromToken );

const originalEnv = { ...process.env };

beforeEach( () => {
	vi.clearAllMocks();
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', '2.3.4' );
	mockInstallId.mockResolvedValue( 'install-uuid' );
	mockIsA11n.mockResolvedValue( false );
	mockOptedOut.mockResolvedValue( false );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	process.env = { ...originalEnv };
} );

describe( 'getTracksOrigin', () => {
	afterEach( () => {
		delete process.env.STUDIO_TRACKS_ORIGIN;
	} );

	it( 'defaults to studio-cli with no ui_version when the env is absent', () => {
		delete process.env.STUDIO_TRACKS_ORIGIN;
		expect( getTracksOrigin() ).toEqual( { channel: 'studio-cli' } );
	} );

	it( 'resolves studio-ui:v1', () => {
		process.env.STUDIO_TRACKS_ORIGIN = 'studio-ui:v1';
		expect( getTracksOrigin() ).toEqual( { channel: 'studio-ui', ui_version: 'v1' } );
	} );

	it( 'resolves studio-ui:v2', () => {
		process.env.STUDIO_TRACKS_ORIGIN = 'studio-ui:v2';
		expect( getTracksOrigin() ).toEqual( { channel: 'studio-ui', ui_version: 'v2' } );
	} );
} );

describe( 'recordTracksEvent', () => {
	it( 'does not send when the build-time telemetry flag is off', async () => {
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );
		delete process.env.STUDIO_FORCE_CLI_TELEMETRY;

		await recordTracksEvent( TRACKS_EVENTS.SITE_START, { channel: 'studio-cli' } );

		expect( mockRecord ).not.toHaveBeenCalled();
		expect( mockOptedOut ).not.toHaveBeenCalled();
	} );

	it( 'STUDIO_FORCE_CLI_TELEMETRY overrides the build-time flag being off', async () => {
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );
		process.env.STUDIO_FORCE_CLI_TELEMETRY = '1';

		await recordTracksEvent( TRACKS_EVENTS.SITE_START, { channel: 'studio-cli' } );

		expect( mockRecord ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not send when opted out', async () => {
		mockOptedOut.mockResolvedValue( true );

		await recordTracksEvent( TRACKS_EVENTS.SITE_START, { channel: 'studio-cli' } );

		expect( mockRecord ).not.toHaveBeenCalled();
		expect( mockInstallId ).not.toHaveBeenCalled();
	} );

	it( 'sends with anonymous identity and common props when enabled and opted in', async () => {
		await recordTracksEvent( TRACKS_EVENTS.SITE_START, {
			channel: 'studio-cli',
		} );

		expect( mockRecord ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_START,
			{ type: 'anon', id: 'install-uuid' },
			expect.objectContaining( {
				platform: process.platform,
				arch: process.arch,
				app_version: '2.3.4',
				is_a11n: false,
				channel: 'studio-cli',
			} )
		);
	} );
} );
