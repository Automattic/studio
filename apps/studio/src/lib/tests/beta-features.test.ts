/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { updateBetaFeature } from 'src/lib/beta-features';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { loadUserData } from 'src/storage/user-data';

vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( 'src/storage/user-data', () => ( {
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
	loadUserData: vi.fn( async () => ( {} ) ),
	saveUserData: vi.fn(),
} ) );

const mockRecord = vi.mocked( recordTracksEvent );
const mockLoadUserData = vi.mocked( loadUserData );

beforeEach( () => {
	vi.clearAllMocks();
	mockLoadUserData.mockResolvedValue( {} as Awaited< ReturnType< typeof loadUserData > > );
} );

it( 'emits studio_setting_ui_change with type "agentic" and the given surface when enabling the agentic UI', async () => {
	await updateBetaFeature( 'enableAgenticUi', true, 'banner' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_UI_CHANGE, {
		type: 'agentic',
		surface: 'banner',
	} );
} );

it( 'emits studio_setting_ui_change with type "classic" and the given surface when disabling the agentic UI', async () => {
	await updateBetaFeature( 'enableAgenticUi', false, 'menu' );

	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_UI_CHANGE, {
		type: 'classic',
		surface: 'menu',
	} );
} );

it( 'does not emit when no surface is given (e.g. the boot-time migration)', async () => {
	await updateBetaFeature( 'enableAgenticUi', true );

	expect( mockRecord ).not.toHaveBeenCalled();
} );

it( 'does not emit for other beta feature keys', async () => {
	await updateBetaFeature( 'remoteSession', true, 'settings' );

	expect( mockRecord ).not.toHaveBeenCalled();
} );
