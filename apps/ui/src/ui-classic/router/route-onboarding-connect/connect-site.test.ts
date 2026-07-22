import { describe, expect, it, vi } from 'vitest';
import {
	ConnectSiteLifecycleError,
	findAvailableSitePath,
	runConnectSiteLifecycle,
} from './connect-site';
import type { SiteDetails } from '@/data/core';

const localSite = { id: 'local-1', name: 'Example', path: '/sites/example' } as SiteDetails;

function createLifecycle( failingStage?: string ) {
	const calls: string[] = [];
	const step = < T = void >( name: string, result?: T ) =>
		vi.fn( async () => {
			calls.push( name );
			if ( failingStage === name ) throw new Error( `${ name } failed` );
			return result as T;
		} );

	return {
		calls,
		lifecycle: {
			createLocalSite: step( 'create', localSite ),
			persistConnection: step( 'connect' ),
			pullRemoteSite: step( 'pull' ),
			startLocalSite: step( 'start' ),
			openLocalSite: step( 'open' ),
			deleteLocalSite: step( 'delete' ),
		},
	};
}

describe( 'runConnectSiteLifecycle', () => {
	it( 'creates, connects, pulls, starts, and opens in order', async () => {
		const { calls, lifecycle } = createLifecycle();

		await expect( runConnectSiteLifecycle( lifecycle ) ).resolves.toBe( localSite );
		expect( calls ).toEqual( [ 'create', 'connect', 'pull', 'start', 'open' ] );
	} );

	it.each( [ 'connect' ] )( 'removes the local shell when %s fails', async ( stage ) => {
		const { calls, lifecycle } = createLifecycle( stage );

		const error = await runConnectSiteLifecycle( lifecycle ).catch( ( value ) => value );

		expect( error ).toBeInstanceOf( ConnectSiteLifecycleError );
		expect( error ).toMatchObject( {
			message: `${ stage } failed`,
			connectionPersisted: false,
			localSiteId: localSite.id,
		} );
		expect( calls ).toEqual( [ 'create', stage, 'delete' ] );
	} );

	it( 'does not clean up when creating the shell fails', async () => {
		const { calls, lifecycle } = createLifecycle( 'create' );

		await expect( runConnectSiteLifecycle( lifecycle ) ).rejects.toMatchObject( {
			connectionPersisted: false,
			localSiteId: undefined,
		} );
		expect( calls ).toEqual( [ 'create' ] );
	} );

	it.each( [ 'pull', 'start', 'open' ] )(
		'retains the shell and persisted connection when %s fails',
		async ( stage ) => {
			const { calls, lifecycle } = createLifecycle( stage );

			await expect( runConnectSiteLifecycle( lifecycle ) ).rejects.toMatchObject( {
				message: `${ stage } failed`,
				connectionPersisted: true,
				localSiteId: localSite.id,
			} );
			expect( calls ).not.toContain( 'delete' );
		}
	);

	it( 'keeps the original error when cleanup also fails', async () => {
		const { lifecycle } = createLifecycle( 'connect' );
		lifecycle.deleteLocalSite.mockRejectedValueOnce( new Error( 'delete failed' ) );

		await expect( runConnectSiteLifecycle( lifecycle ) ).rejects.toThrow( 'connect failed' );
	} );

	it( 'opens the site while pull and start continue in the background', async () => {
		let finishPull: () => void = () => {};
		const pullPending = new Promise< void >( ( resolve ) => {
			finishPull = resolve;
		} );
		const { calls, lifecycle } = createLifecycle();
		lifecycle.pullRemoteSite.mockImplementationOnce( async () => {
			calls.push( 'pull' );
			await pullPending;
		} );

		await expect(
			runConnectSiteLifecycle( { ...lifecycle, backgroundAfterConnection: true } )
		).resolves.toBe( localSite );
		expect( calls ).toEqual( [ 'create', 'connect', 'pull', 'open' ] );

		finishPull();
		await vi.waitFor( () =>
			expect( calls ).toEqual( [ 'create', 'connect', 'pull', 'open', 'start' ] )
		);
	} );

	it( 'reports background failures without deleting the persisted shell', async () => {
		const { calls, lifecycle } = createLifecycle( 'pull' );
		const onBackgroundError = vi.fn();

		await runConnectSiteLifecycle( {
			...lifecycle,
			backgroundAfterConnection: true,
			onBackgroundError,
		} );

		await vi.waitFor( () => expect( onBackgroundError ).toHaveBeenCalledOnce() );
		expect( onBackgroundError ).toHaveBeenCalledWith(
			expect.objectContaining( {
				message: 'pull failed',
				connectionPersisted: true,
				localSiteId: localSite.id,
			} )
		);
		expect( calls ).not.toContain( 'delete' );
	} );
} );

describe( 'findAvailableSitePath', () => {
	it( 'returns the first empty generated path and increments the name', async () => {
		const generatePath = vi
			.fn()
			.mockResolvedValueOnce( { path: '/sites/example', isEmpty: false, isWordPress: true } )
			.mockResolvedValueOnce( {
				path: '/sites/example-2',
				isEmpty: true,
				isWordPress: false,
			} );

		await expect( findAvailableSitePath( 'Example', generatePath ) ).resolves.toEqual( {
			name: 'Example 2',
			path: '/sites/example-2',
		} );
		expect( generatePath ).toHaveBeenNthCalledWith( 1, 'Example' );
		expect( generatePath ).toHaveBeenNthCalledWith( 2, 'Example 2' );
	} );
} );
