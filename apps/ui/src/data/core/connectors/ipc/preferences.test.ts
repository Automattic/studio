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
} );
