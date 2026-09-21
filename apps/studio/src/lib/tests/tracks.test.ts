/**
 * @vitest-environment node
 */
import { app } from 'electron';
import { __recordTracksEvent, TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	getOrCreateAnalyticsInstallId,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { getPreferredUiVersion } from 'src/lib/studio-ui-mode';
import { recordTracksEvent } from '../tracks';

vi.mock( import( 'electron' ), async ( importActual ) => {
	const actual = await importActual();
	return {
		...actual,
		app: { ...actual.app, getVersion: vi.fn( () => '9.9.9' ) },
	};
} );
vi.mock( '@studio/common/lib/record-tracks-event', async ( importActual ) => {
	const actual = await importActual< typeof import('@studio/common/lib/record-tracks-event') >();
	return { ...actual, __recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	getOrCreateAnalyticsInstallId: vi.fn(),
	isAnalyticsOptedOut: vi.fn(),
	isAutomatticianFromToken: vi.fn(),
} ) );
vi.mock( 'src/lib/studio-ui-mode', () => ( { getPreferredUiVersion: vi.fn() } ) );

const mockRecord = vi.mocked( __recordTracksEvent );
const mockInstallId = vi.mocked( getOrCreateAnalyticsInstallId );
const mockOptedOut = vi.mocked( isAnalyticsOptedOut );
const mockIsA11n = vi.mocked( isAutomatticianFromToken );
const mockUiVersion = vi.mocked( getPreferredUiVersion );

const originalEnv = { ...process.env };

beforeEach( () => {
	vi.clearAllMocks();
	mockInstallId.mockResolvedValue( 'install-uuid' );
	mockIsA11n.mockResolvedValue( false );
	mockUiVersion.mockReturnValue( 'v1' );
	vi.mocked( app.getVersion ).mockReturnValue( '9.9.9' );
	// The dev/CI-build gate reads these; clear them so the "sends when opted in" assertions don't
	// flake when the suite itself runs under CI (which sets CI=true) or a dev build (IS_DEV_BUILD).
	delete process.env.IS_DEV_BUILD;
	delete process.env.CI;
} );

afterEach( () => {
	process.env = { ...originalEnv };
} );

it( 'does not send from a dev build (IS_DEV_BUILD set)', async () => {
	mockOptedOut.mockResolvedValue( false );
	process.env.IS_DEV_BUILD = 'true';

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( mockOptedOut ).not.toHaveBeenCalled();
} );

it( 'does not send from a CI build (CI set)', async () => {
	mockOptedOut.mockResolvedValue( false );
	process.env.CI = 'true';

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( mockOptedOut ).not.toHaveBeenCalled();
} );

it( 'does not send when opted out', async () => {
	mockOptedOut.mockResolvedValue( true );

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH );

	expect( mockRecord ).not.toHaveBeenCalled();
	expect( mockInstallId ).not.toHaveBeenCalled();
} );

it( 'attaches channel and ui_version from commonProps without a call-site opt-in', async () => {
	mockOptedOut.mockResolvedValue( false );
	mockIsA11n.mockResolvedValue( true );

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, { is_first_launch: true } );

	expect( mockInstallId ).toHaveBeenCalledTimes( 1 );
	expect( mockRecord ).toHaveBeenCalledWith(
		TRACKS_EVENTS.APP_LAUNCH,
		{ type: 'anon', id: 'install-uuid' },
		expect.objectContaining( {
			platform: process.platform,
			arch: process.arch,
			app_version: '9.9.9',
			is_a11n: true,
			channel: 'studio-ui',
			ui_version: 'v1',
			is_first_launch: true,
		} )
	);
} );

it( 'attaches ui_version: v2 when the agentic renderer is active', async () => {
	mockOptedOut.mockResolvedValue( false );
	mockUiVersion.mockReturnValue( 'v2' );

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH );

	expect( mockRecord ).toHaveBeenCalledWith(
		TRACKS_EVENTS.APP_LAUNCH,
		{ type: 'anon', id: 'install-uuid' },
		expect.objectContaining( { channel: 'studio-ui', ui_version: 'v2' } )
	);
} );
