/**
 * @jest-environment node
 */
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleSyncConnectSiteDeeplink } from 'src/lib/deeplink/handlers/sync-connect-site';

jest.mock( 'src/ipc-utils' );

describe( 'handleSyncConnectSiteDeeplink', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should handle sync connect site callback', async () => {
		const url = new URL( 'wp-studio://sync-connect-site?remoteSiteId=123&studioSiteId=local-site' );
		await handleSyncConnectSiteDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'sync-connect-site', {
			remoteSiteId: 123,
			studioSiteId: 'local-site',
			autoOpenPush: false,
		} );
	} );

	it( 'should not send sync connect site event if parameters are missing', async () => {
		const url = new URL( 'wp-studio://sync-connect-site?remoteSiteId=123' );
		await handleSyncConnectSiteDeeplink( url );

		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );
} );
