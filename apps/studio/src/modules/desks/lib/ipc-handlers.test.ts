/**
 * @vitest-environment node
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { vi } from 'vitest';
import { loadMainWindowRenderer } from 'src/main-window';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { getStudioUiMode, setStudioUiMode } from './ipc-handlers';
import type { UserData } from 'src/storage/storage-types';

vi.mock( 'electron', () => ( {
	BrowserWindow: {
		fromWebContents: vi.fn(),
	},
	dialog: {
		showOpenDialog: vi.fn(),
		showSaveDialog: vi.fn(),
	},
} ) );

vi.mock( 'src/main-window', () => ( {
	loadMainWindowRenderer: vi.fn().mockResolvedValue( undefined ),
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	lockAppdata: vi.fn().mockResolvedValue( undefined ),
	saveUserData: vi.fn().mockResolvedValue( undefined ),
	unlockAppdata: vi.fn().mockResolvedValue( undefined ),
} ) );

const mockEvent = {
	sender: {},
	frameId: 1,
} as IpcMainInvokeEvent;

const mockUserData: UserData = {
	version: 1,
	siteMetadata: {},
};

describe( 'desk Studio UI mode IPC handlers', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.useRealTimers();
		vi.mocked( loadUserData ).mockResolvedValue( mockUserData );
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValue( {
			isDestroyed: vi.fn().mockReturnValue( false ),
		} as unknown as BrowserWindow );
	} );

	it.each( [
		[ 'default', 'default' ],
		[ 'studio2', 'studio2' ],
		[ 'agentic', 'studio2' ],
		[ 'desks', 'studio2' ],
	] )( 'returns %s stored mode as %s', async ( storedMode, expectedMode ) => {
		vi.mocked( loadUserData ).mockResolvedValue( {
			...mockUserData,
			desks: {
				defaultUiMode: storedMode as never,
			},
		} );

		await expect( getStudioUiMode( mockEvent ) ).resolves.toBe( expectedMode );
	} );

	it( 'normalizes legacy mode before persisting and reloading', async () => {
		vi.useFakeTimers();
		vi.mocked( loadUserData ).mockResolvedValue( {
			...mockUserData,
			desks: {
				defaultUiMode: 'default',
			},
		} );
		const parentWindow = {
			isDestroyed: vi.fn().mockReturnValue( false ),
		} as unknown as BrowserWindow;
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValue( parentWindow );

		await setStudioUiMode( mockEvent, 'agentic' );
		await vi.runAllTimersAsync();

		expect( saveUserData ).toHaveBeenCalledWith( {
			...mockUserData,
			desks: {
				defaultUiMode: 'studio2',
			},
		} );
		expect( loadMainWindowRenderer ).toHaveBeenCalledWith( parentWindow, 'studio2' );
	} );

	it( 'rejects invalid mode before locking or saving', async () => {
		await expect( setStudioUiMode( mockEvent, 'invalid' as never ) ).rejects.toThrow(
			'Invalid Studio UI mode.'
		);

		expect( lockAppdata ).not.toHaveBeenCalled();
		expect( saveUserData ).not.toHaveBeenCalled();
		expect( unlockAppdata ).not.toHaveBeenCalled();
	} );
} );
