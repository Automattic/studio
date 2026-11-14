/**
 * @vitest-environment node
 */
import { app } from 'electron';
import {
	__recordTracksEvent,
	TRACKS_EVENTS,
	type TracksProps,
	type TracksEventName,
} from '@studio/common/lib/record-tracks-event';
import {
	getTracksIdentity,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
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
	getTracksIdentity: vi.fn(),
	isAnalyticsOptedOut: vi.fn(),
	isAutomatticianFromToken: vi.fn(),
} ) );

const mockRecord = vi.mocked( __recordTracksEvent );
const mockIdentity = vi.mocked( getTracksIdentity );
const mockOptedOut = vi.mocked( isAnalyticsOptedOut );
const mockIsA11n = vi.mocked( isAutomatticianFromToken );

const originalEnv = { ...process.env };

beforeEach( () => {
	vi.clearAllMocks();
	mockIdentity.mockResolvedValue( { type: 'anon', id: 'install-uuid' } );
	mockIsA11n.mockResolvedValue( false );
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
	expect( mockIdentity ).not.toHaveBeenCalled();
} );

it( 'attaches channel and ui_version from commonProps without a call-site opt-in', async () => {
	mockOptedOut.mockResolvedValue( false );
	mockIsA11n.mockResolvedValue( true );

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, { is_first_launch: true } );

	expect( mockIdentity ).toHaveBeenCalledTimes( 1 );
	expect( mockRecord ).toHaveBeenCalledWith(
		TRACKS_EVENTS.APP_LAUNCH,
		{ type: 'anon', id: 'install-uuid' },
		expect.objectContaining( {
			platform: process.platform,
			arch: process.arch,
			app_version: '9.9.9',
			is_a11n: true,
			channel: 'studio-ui',
			ui_version: 'v2',
			is_first_launch: true,
		} )
	);
} );

it.each( [
	TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED,
	TRACKS_EVENTS.ONBOARDING_VIEWED,
	TRACKS_EVENTS.WPCOM_AUTH_STARTED,
	TRACKS_EVENTS.WPCOM_AUTH_CANCELLED,
	TRACKS_EVENTS.WPCOM_AUTH_LAUNCH_FAILED,
	TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED,
	TRACKS_EVENTS.WPCOM_AUTH,
	TRACKS_EVENTS.ONBOARDING_COMPLETE,
	TRACKS_EVENTS.CODE_MESSAGE_SENT,
	TRACKS_EVENTS.CODE_TURN_COMPLETED,
] )( 'opt-out suppresses account/turn event %s', async ( name ) => {
	mockOptedOut.mockResolvedValue( true );
	await recordTracksEvent( name );
	expect( mockRecord ).not.toHaveBeenCalled();
	expect( mockIdentity ).not.toHaveBeenCalled();
} );

describe.each( [
	[ TRACKS_EVENTS.BLUEPRINT_VIEWED, { blueprint_slug: 'substrata', use_case: 'blog' } ],
	[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'all' } ],
	[
		TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
		{ blueprint_slug: 'substrata', placement: 'add_site_blueprint_details' },
	],
	[
		TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
		{ blueprint_slug: 'substrata', placement: 'add_site_blueprint_details' },
	],
	[ TRACKS_EVENTS.BLANK_SITE_SELECTED, { placement: 'add_site_blueprint_gallery' } ],
	[
		TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
		{
			action: 'manual_resize',
			preset_category: 'custom',
			width_bucket: 'under_600',
			height_bucket: '600_to_1023',
		},
	],
] satisfies [ TracksEventName, TracksProps ][] )( 'UI event %s', ( event, props ) => {
	it( 'does not send or create an install identity when opted out', async () => {
		mockOptedOut.mockResolvedValue( true );
		await recordTracksEvent( event, props );
		expect( mockRecord ).not.toHaveBeenCalled();
		expect( mockIdentity ).not.toHaveBeenCalled();
	} );
	it.each( [ 'IS_DEV_BUILD', 'CI' ] )(
		'does not send when %s disables tracking',
		async ( gate ) => {
			process.env[ gate ] = 'true';
			await recordTracksEvent( event, props );
			expect( mockRecord ).not.toHaveBeenCalled();
			expect( mockIdentity ).not.toHaveBeenCalled();
		}
	);
	it( 'sends once with anonymous identity, common props and the original action props', async () => {
		mockOptedOut.mockResolvedValue( false );
		await recordTracksEvent( event, props );
		expect( mockRecord ).toHaveBeenCalledExactlyOnceWith(
			event,
			{ type: 'anon', id: 'install-uuid' },
			{
				...props,
				platform: process.platform,
				arch: process.arch,
				is_a11n: false,
				app_version: '9.9.9',
				channel: 'studio-ui',
				ui_version: 'v2',
			}
		);
	} );
} );

it( 'keeps workspace layout telemetry silent when opted out', async () => {
	mockOptedOut.mockResolvedValue( true );
	await recordTracksEvent( TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED, { layout: 'panel' } );
	expect( mockRecord ).not.toHaveBeenCalled();
	expect( mockIdentity ).not.toHaveBeenCalled();
} );

it( 'attributes the event to the WordPress.com user when logged in', async () => {
	mockOptedOut.mockResolvedValue( false );
	mockIdentity.mockResolvedValue( {
		type: 'wpcom:user_id',
		id: '12345',
		installId: 'install-uuid',
	} );

	await recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH );

	expect( mockRecord ).toHaveBeenCalledWith(
		TRACKS_EVENTS.APP_LAUNCH,
		{ type: 'wpcom:user_id', id: '12345', installId: 'install-uuid' },
		expect.any( Object )
	);
} );
