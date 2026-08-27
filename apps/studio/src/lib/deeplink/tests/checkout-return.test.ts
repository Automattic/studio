/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleDeeplink } from 'src/lib/deeplink/deeplink-handler';
import { getMainWindow } from 'src/main-window';

vi.mock( 'src/ipc-utils' );
vi.mock( 'src/main-window' );

const mainWindow = {
	isMinimized: vi.fn( () => false ),
	restore: vi.fn(),
	focus: vi.fn(),
};

describe( 'the checkout-return deeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mainWindow.isMinimized.mockReturnValue( false );
		vi.mocked( getMainWindow ).mockResolvedValue( mainWindow as never );
	} );

	it( 'focuses Studio and tells the renderer the credits purchase finished', async () => {
		await handleDeeplink( 'wp-studio://checkout-return?studioReturnTo=ai-credits-purchased' );

		expect( mainWindow.focus ).toHaveBeenCalled();
		expect( mainWindow.restore ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'ai-credits-purchased' );
	} );

	it( 'restores the window first when Studio was minimized', async () => {
		mainWindow.isMinimized.mockReturnValue( true );

		await handleDeeplink( 'wp-studio://checkout-return?studioReturnTo=ai-credits-purchased' );

		expect( mainWindow.restore ).toHaveBeenCalled();
		expect( mainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'falls back to the credits flow when checkout omits the destination', async () => {
		await handleDeeplink( 'wp-studio://checkout-return' );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'ai-credits-purchased' );
	} );

	it( 'ignores a destination Studio does not know', async () => {
		await handleDeeplink( 'wp-studio://checkout-return?studioReturnTo=some-future-flow' );

		expect( mainWindow.focus ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );
} );
