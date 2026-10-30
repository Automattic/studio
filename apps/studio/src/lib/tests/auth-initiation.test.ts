/**
 * @vitest-environment node
 */
import { shell } from 'electron';
import { getAuthTracksProps } from '@studio/common/lib/auth-tracks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from 'src/ipc-handlers';
import { __resetPendingAuthContext, takePendingAuthContext } from 'src/lib/auth-tracks-context';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/lib/locale-node', () => ( { getUserLocaleWithFallback: async () => 'en' } ) );
vi.mock( 'src/lib/shell-open-external-wrapper', async ( original ) => ( {
	...( await original< typeof import('src/lib/shell-open-external-wrapper') >() ),
	shellOpenExternalWrapper: vi.fn( async () => undefined ),
} ) );
vi.mock( 'src/lib/tracks', async ( original ) => ( {
	...( await original< typeof import('src/lib/tracks') >() ),
	recordTracksEvent: vi.fn( async () => undefined ),
} ) );

beforeEach( () => {
	vi.clearAllMocks();
	__resetPendingAuthContext();
	vi.mocked( shellOpenExternalWrapper ).mockResolvedValue();
	vi.mocked( recordTracksEvent ).mockResolvedValue();
} );

const event = {} as IpcMainInvokeEvent;
const analytics = {
	placement: 'publish',
	intent: 'publish',
	journey_id: crypto.randomUUID(),
} as const;

describe( 'Desktop authentication initiation', () => {
	it.each( [ false, true ] )(
		'matches the launched URL to its recorded start (signup=%s)',
		async ( signup ) => {
			await authenticate( event, signup, 'sync_tab', analytics );
			const launched = new URL( vi.mocked( shellOpenExternalWrapper ).mock.calls[ 0 ][ 0 ] );
			const authorize = signup
				? new URL( launched.searchParams.get( 'oauth2_redirect' )! )
				: launched;
			const id = authorize.searchParams.get( 'state' )!;
			const context = takePendingAuthContext( id );
			expect( context ).toBeDefined();
			expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
				TRACKS_EVENTS.WPCOM_AUTH_STARTED,
				getAuthTracksProps( context )
			);
			expect( context?.analytics ).toEqual( analytics );
		}
	);
	it( 'reports a failed handoff and clears its pending callback context', async () => {
		vi.mocked( shellOpenExternalWrapper ).mockRejectedValueOnce(
			new Error( 'Browser unavailable' )
		);
		await expect( authenticate( event, false, 'sync_tab', analytics ) ).rejects.toThrow(
			'Browser unavailable'
		);
		const props = vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ];
		expect( recordTracksEvent ).toHaveBeenLastCalledWith(
			TRACKS_EVENTS.WPCOM_AUTH_LAUNCH_FAILED,
			props
		);
		expect( takePendingAuthContext( String( props?.auth_attempt_id ) ) ).toBeUndefined();
	} );
	it( 'does not block authentication when start telemetry fails', async () => {
		vi.mocked( recordTracksEvent ).mockRejectedValueOnce( new Error( 'Analytics unavailable' ) );
		await expect( authenticate( event, false, 'sync_tab', analytics ) ).resolves.toBeUndefined();
		expect( shellOpenExternalWrapper ).toHaveBeenCalledOnce();
	} );
	it( 'allows the auth caller to observe an actual shell handoff failure', async () => {
		const actual = await vi.importActual< typeof import('src/lib/shell-open-external-wrapper') >(
			'src/lib/shell-open-external-wrapper'
		);
		Object.assign( shell, {
			openExternal: vi.fn().mockRejectedValueOnce( new Error( 'No browser' ) ),
		} );
		await expect(
			actual.shellOpenExternalWrapper( 'https://wordpress.com', { throwOnError: true } )
		).rejects.toThrow( 'No browser' );
	} );
} );
