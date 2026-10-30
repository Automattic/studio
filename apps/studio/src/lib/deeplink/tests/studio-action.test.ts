import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleDeeplink } from 'src/lib/deeplink/deeplink-handler';
import { handleStudioActionDeeplink } from 'src/lib/deeplink/handlers/studio-action';
import { buildStudioActionLink } from 'src/lib/deeplink/studio-action-link';
import { getMainWindow } from 'src/main-window';

vi.mock( 'src/ipc-utils' );
vi.mock( 'src/main-window' );

const window = {
	isMinimized: vi.fn( () => true ),
	restore: vi.fn(),
	show: vi.fn(),
	focus: vi.fn(),
};

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( getMainWindow ).mockResolvedValue( window as never );
} );

it( 'restores Studio and opens the site creation dialog', async () => {
	await handleDeeplink( buildStudioActionLink( { action: 'new-site' } ) );
	expect( window.restore ).toHaveBeenCalled();
	expect( window.show ).toHaveBeenCalled();
	expect( window.focus ).toHaveBeenCalled();
	expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'add-site' );
} );

it( 'passes the selected site identifier to the renderer', async () => {
	await handleDeeplink( buildStudioActionLink( { action: 'open-site', siteId: 'site-one' } ) );
	expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'open-site', { siteId: 'site-one' } );
} );

it( 'does not open a window for a malformed action', async () => {
	await handleStudioActionDeeplink( new URL( 'wp-studio://app/v1/open-site?id=' ) );
	expect( getMainWindow ).not.toHaveBeenCalled();
} );
