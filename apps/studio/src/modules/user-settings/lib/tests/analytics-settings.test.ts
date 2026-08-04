/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { updateSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { saveAnalyticsEnabled } from 'src/modules/user-settings/lib/ipc-handlers';

vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	updateSharedConfig: vi.fn(),
	isAnalyticsOptedOut: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const mockUpdate = vi.mocked( updateSharedConfig );
const event = {} as IpcMainInvokeEvent;

beforeEach( () => {
	vi.clearAllMocks();
} );

it( 'emits studio_setting_telemetry_change with status "on" and the source when enabling analytics', async () => {
	await saveAnalyticsEnabled( event, true, { surface: 'settings' } );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_TELEMETRY_CHANGE, {
		surface: 'settings',
		status: 'on',
	} );
	expect( mockUpdate ).toHaveBeenCalledWith( { analyticsOptOut: false } );
} );

it( 'emits studio_setting_telemetry_change with status "off" and the source when disabling analytics', async () => {
	await saveAnalyticsEnabled( event, false, { surface: 'onboarding' } );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_TELEMETRY_CHANGE, {
		surface: 'onboarding',
		status: 'off',
	} );
	expect( mockUpdate ).toHaveBeenCalledWith( { analyticsOptOut: true } );
} );

// `recordTracksEvent` is gated by the opt-out state, so both transitions must be recorded while
// analytics is still ON: before the write when turning off, after the write when turning on.
function trackOrder() {
	const calls: string[] = [];
	mockRecord.mockImplementation( async () => {
		calls.push( 'record' );
	} );
	mockUpdate.mockImplementation( async () => {
		calls.push( 'update' );
	} );
	return calls;
}

it( 'records the off-transition before the opt-out gate is written', async () => {
	const calls = trackOrder();

	await saveAnalyticsEnabled( event, false, { surface: 'settings' } );

	expect( calls ).toEqual( [ 'record', 'update' ] );
} );

it( 'records the on-transition after the opt-out gate is cleared', async () => {
	const calls = trackOrder();

	await saveAnalyticsEnabled( event, true, { surface: 'settings' } );

	expect( calls ).toEqual( [ 'update', 'record' ] );
} );
