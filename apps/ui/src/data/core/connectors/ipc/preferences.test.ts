import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './index';

describe( 'createIpcConnector chat startup preference', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( 'reads and writes the preference through the preload bridge', async () => {
		const setUserPreferences = vi.fn().mockResolvedValue( undefined );
		vi.stubGlobal( 'ipcApi', {
			getUserPreferences: vi.fn().mockResolvedValue( {
				autoStartSiteOnChat: true,
				showRecentChats: true,
			} ),
			isStudioCliInstalled: vi.fn().mockResolvedValue( false ),
			isStudioCliExternallyManaged: vi.fn().mockResolvedValue( false ),
			setUserPreferences,
		} );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
		const connector = createIpcConnector();
		await expect( connector.getUserPreferences() ).resolves.toMatchObject( {
			autoStartSiteOnChat: true,
			showRecentChats: true,
		} );
		await connector.setUserPreferences( { autoStartSiteOnChat: false } );
		expect( setUserPreferences ).toHaveBeenCalledExactlyOnceWith( { autoStartSiteOnChat: false } );
	} );

	it( 'passes site admin bar overrides and reset through the preload bridge', async () => {
		const setSiteFrontendAdminBar = vi.fn().mockResolvedValue( undefined );
		vi.stubGlobal( 'ipcApi', { setSiteFrontendAdminBar } );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
		const connector = createIpcConnector();
		await connector.setSiteFrontendAdminBar( 'one', false );
		await connector.setSiteFrontendAdminBar( 'one', null );
		expect( setSiteFrontendAdminBar.mock.calls ).toEqual( [
			[ 'one', false ],
			[ 'one', null ],
		] );
	} );
} );

it( 'passes model and effort through the Desktop bridge for selection and sending', async () => {
	const setAiSessionModel = vi.fn().mockResolvedValue( undefined );
	const setAiSessionProvider = vi.fn().mockResolvedValue( undefined );
	const continueAiSession = vi.fn().mockResolvedValue( { runId: 'test-run' } );
	vi.stubGlobal( 'ipcApi', { setAiSessionModel, setAiSessionProvider, continueAiSession } );
	vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
	try {
		const connector = createIpcConnector();
		await connector.setSessionModel( 'chat', 'balanced', 'high' );
		await connector.setSessionProvider( 'chat', 'wpcom', 'balanced', 'low' );
		await connector.continueSession( 'chat', 'Queued message', {
			model: 'balanced',
			effort: 'high',
		} );
		expect( setAiSessionModel ).toHaveBeenCalledWith( 'chat', 'balanced', 'high' );
		expect( setAiSessionProvider ).toHaveBeenCalledWith( 'chat', 'wpcom', 'balanced', 'low' );
		expect( continueAiSession ).toHaveBeenCalledWith( 'chat', 'Queued message', {
			model: 'balanced',
			effort: 'high',
		} );
	} finally {
		vi.unstubAllGlobals();
	}
} );
