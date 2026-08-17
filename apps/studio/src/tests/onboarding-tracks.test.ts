/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { beforeEach, vi } from 'vitest';
import { saveOnboarding } from 'src/ipc-handlers';
import * as oauthClient from 'src/lib/oauth';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { loadUserData } from 'src/storage/user-data';

vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( 'src/lib/oauth', () => ( { isAuthenticated: vi.fn() } ) );
vi.mock( 'src/storage/user-data', async ( importActual ) => {
	const actual = await importActual< typeof import('src/storage/user-data') >();
	return { ...actual, loadUserData: vi.fn(), updateAppdata: vi.fn() };
} );

const event = {} as IpcMainInvokeEvent;

function mockPreviouslyCompleted( onboardingCompleted: boolean ) {
	vi.mocked( loadUserData ).mockResolvedValue( { onboardingCompleted } as never );
}

function onboardingEvents() {
	return vi
		.mocked( recordTracksEvent )
		.mock.calls.filter( ( [ name ] ) => name === TRACKS_EVENTS.ONBOARDING_COMPLETE );
}

describe( 'saveOnboarding Tracks event', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( oauthClient.isAuthenticated ).mockResolvedValue( false );
	} );

	it( 'records the completion when onboarding is finished for the first time', async () => {
		mockPreviouslyCompleted( false );
		vi.mocked( oauthClient.isAuthenticated ).mockResolvedValue( true );

		await saveOnboarding( event, true );

		expect( onboardingEvents() ).toEqual( [
			[ TRACKS_EVENTS.ONBOARDING_COMPLETE, { authenticated: true } ],
		] );
	} );

	// Skipping is just finishing without an account — that is what `authenticated: false` records.
	it( 'reports an unauthenticated completion when the user skipped signing in', async () => {
		mockPreviouslyCompleted( false );

		await saveOnboarding( event, true );

		expect( onboardingEvents() ).toEqual( [
			[ TRACKS_EVENTS.ONBOARDING_COMPLETE, { authenticated: false } ],
		] );
	} );

	// Otherwise a re-save would look like another user finishing onboarding.
	it( 'does not record a second time when onboarding was already complete', async () => {
		mockPreviouslyCompleted( true );

		await saveOnboarding( event, true );

		expect( onboardingEvents() ).toEqual( [] );
	} );

	it( 'does not record when onboarding is reset', async () => {
		mockPreviouslyCompleted( true );

		await saveOnboarding( event, false );

		expect( onboardingEvents() ).toEqual( [] );
	} );
} );
