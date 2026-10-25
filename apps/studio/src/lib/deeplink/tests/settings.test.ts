/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleDeeplink } from 'src/lib/deeplink/deeplink-handler';
import { takePendingSettingsLink } from 'src/lib/deeplink/handlers/settings';
import { getMainWindow } from 'src/main-window';

vi.mock( 'src/ipc-utils' );
vi.mock( 'src/main-window' );

const mainWindow = {
	isMinimized: vi.fn( () => false ),
	restore: vi.fn(),
	focus: vi.fn(),
};

describe( 'the settings deeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getMainWindow ).mockResolvedValue( mainWindow as never );
	} );

	it( 'focuses Studio and opens Settings on the linked setting', async () => {
		await handleDeeplink( 'wp-studio://app/v1/settings?id=code-editor' );

		expect( mainWindow.focus ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'user-settings', {
			settingId: 'code-editor',
		} );
		expect( takePendingSettingsLink() ).toBe( 'code-editor' );
		expect( takePendingSettingsLink() ).toBeNull();
	} );

	it( 'passes an id this version does not know on to the renderer', async () => {
		await handleDeeplink( 'wp-studio://app/v1/settings?id=future-setting' );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'user-settings', {
			settingId: 'future-setting',
		} );
	} );

	it( 'ignores a malformed settings link', async () => {
		await handleDeeplink( 'wp-studio://app/v1/settings?id=../../etc' );
		await handleDeeplink( 'wp-studio://app/v2/settings?id=language' );

		expect( mainWindow.focus ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );
} );
