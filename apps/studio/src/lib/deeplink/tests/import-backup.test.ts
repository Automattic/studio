import { app, dialog, shell, BrowserWindow } from 'electron';
import fs from 'fs-extra';
import { vi, beforeAll, afterAll } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleImportBackupDeeplink } from 'src/lib/deeplink/handlers/import-backup';
import { download } from 'src/lib/download';
import { createMock } from 'src/lib/test-utils';
import { getMainWindow } from 'src/main-window';

// Factory mock so fs.stat is explicitly available (the default automock skips it).
vi.mock( 'fs-extra', () => {
	const mod = {
		mkdir: vi.fn(),
		stat: vi.fn(),
		remove: vi.fn(),
		readJson: vi.fn(),
		writeJson: vi.fn(),
	};
	return { ...mod, default: mod };
} );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/download' );
vi.mock( 'src/main-window' );
vi.mock( 'src/logging', () => ( {
	getLogsFilePath: vi.fn().mockReturnValue( '/mock/path/to/logs.log' ),
} ) );

// Silence console.error output
beforeAll( () => {
	vi.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	vi.spyOn( console, 'error' ).mockRestore();
} );

describe( 'handleImportBackupDeeplink', () => {
	const mockMainWindow = createMock< BrowserWindow >( {
		isMinimized: vi.fn().mockReturnValue( false ),
		restore: vi.fn(),
		focus: vi.fn(),
	} );

	const expectErrorDialog = ( detail: string ) => {
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: 'Failed to import backup',
			detail,
			buttons: [ 'Open Studio Logs', 'OK' ],
			defaultId: 1,
		} );
	};

	const createBackupDeeplink = ( backupUrl: string, name?: string ): URL => {
		const params = new URLSearchParams();
		params.set( 'url', backupUrl );
		if ( name ) {
			params.set( 'name', name );
		}
		return new URL( `wp-studio://import-backup?${ params.toString() }` );
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( mockMainWindow.isMinimized ).mockReturnValue( false );
		vi.mocked( app.getPath ).mockReturnValue( '/tmp' );
		vi.mocked( fs.mkdir ).mockImplementation( async () => {} );
		vi.mocked( getMainWindow ).mockResolvedValue( mockMainWindow );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 1,
			checkboxChecked: false,
		} );
	} );

	it( 'downloads the backup and sends the import IPC event', async () => {
		const backupUrl = 'https://telex.automattic.ai/site.zip';
		const url = createBackupDeeplink( backupUrl );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.stat ).mockResolvedValue( {
			isFile: () => true,
			size: 1234,
		} as unknown as Awaited< ReturnType< typeof fs.stat > > );

		await handleImportBackupDeeplink( url );

		expect( download ).toHaveBeenCalledWith(
			backupUrl,
			expect.stringContaining( 'import-' ),
			false,
			'backup'
		);
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'import-backup-from-deeplink', {
			backupPath: expect.stringContaining( 'import-' ),
			fileName: 'site.zip',
			fileSize: 1234,
		} );
		expect( mockMainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'uses an explicit ?name= when supplied', async () => {
		const backupUrl = 'https://telex.automattic.ai/download?token=abc';
		const url = createBackupDeeplink( backupUrl, 'my-export.tar.gz' );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.stat ).mockResolvedValue( {
			isFile: () => true,
			size: 4096,
		} as unknown as Awaited< ReturnType< typeof fs.stat > > );

		await handleImportBackupDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'import-backup-from-deeplink', {
			backupPath: expect.stringContaining( 'my-export.tar.gz' ),
			fileName: 'my-export.tar.gz',
			fileSize: 4096,
		} );
	} );

	it( 'rejects non-https URL schemes', async () => {
		// http:, file:, ftp: etc. must all be rejected — a network attacker can
		// swap the payload of cleartext http: downloads, and backups carry
		// executable PHP code that Studio runs via WordPress Playground.
		const httpUrl = createBackupDeeplink( 'http://telex.automattic.ai/site.zip' );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( httpUrl );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );

		vi.clearAllMocks();
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 1,
			checkboxChecked: false,
		} );

		const fileUrl = createBackupDeeplink( 'file:///etc/passwd.zip' );
		await handleImportBackupDeeplink( fileUrl );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );

	it( 'rejects hosts that are not in the backup allow list', async () => {
		// Even a well-formed https URL with a valid extension must be refused
		// when it points at a host Studio doesn't trust to produce backups —
		// the deeplink is attacker-triggerable and imports execute PHP.
		const url = createBackupDeeplink( 'https://evil.example/site.zip' );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'rejects look-alike hosts that merely contain an allowed host', async () => {
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		for ( const host of [ 'telex.automattic.ai.evil.com', 'eviltelex.automattic.ai' ] ) {
			vi.clearAllMocks();
			vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
				response: 1,
				checkboxChecked: false,
			} );

			await handleImportBackupDeeplink( createBackupDeeplink( `https://${ host }/site.zip` ) );

			expect( download ).not.toHaveBeenCalled();
			expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		}
	} );

	it( 'rejects unsupported file extensions', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.txt' );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'does nothing if the url parameter is missing', async () => {
		const url = new URL( 'wp-studio://import-backup' );

		await handleImportBackupDeeplink( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );

	it( 'shows an error dialog when the url is malformed', async () => {
		const url = createBackupDeeplink( 'not-a-valid-url' );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'cleans up the temp file and shows an error if download fails', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.zip' );

		vi.mocked( download ).mockRejectedValue( new Error( 'Download failed' ) );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expect( download ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalledWith( expect.stringContaining( 'import-' ) );
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'rejects an empty file', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.zip' );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.stat ).mockResolvedValue( {
			isFile: () => true,
			size: 0,
		} as unknown as Awaited< ReturnType< typeof fs.stat > > );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'shows a network-specific error message for connectivity failures', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.zip' );

		vi.mocked( download ).mockRejectedValue(
			new Error( 'getaddrinfo ENOTFOUND telex.automattic.ai' )
		);
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleImportBackupDeeplink( url );

		expectErrorDialog(
			'Could not connect to the server. Please check your internet connection and try again.'
		);
	} );

	it( 'restores and focuses the window when minimized', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.zip' );

		vi.mocked( mockMainWindow.isMinimized ).mockReturnValue( true );
		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.stat ).mockResolvedValue( {
			isFile: () => true,
			size: 100,
		} as unknown as Awaited< ReturnType< typeof fs.stat > > );

		await handleImportBackupDeeplink( url );

		expect( mockMainWindow.restore ).toHaveBeenCalled();
		expect( mockMainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'opens the logs file when the user clicks Open Studio Logs', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/site.zip' );

		vi.mocked( download ).mockRejectedValue( new Error( 'boom' ) );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );

		await handleImportBackupDeeplink( url );

		expect( shell.openPath ).toHaveBeenCalledWith( '/mock/path/to/logs.log' );
	} );

	it( 'sanitizes weird characters in the derived file name', async () => {
		const url = createBackupDeeplink( 'https://telex.automattic.ai/some site!@#.zip' );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.stat ).mockResolvedValue( {
			isFile: () => true,
			size: 10,
		} as unknown as Awaited< ReturnType< typeof fs.stat > > );

		await handleImportBackupDeeplink( url );

		const call = vi.mocked( sendIpcEventToRenderer ).mock.calls[ 0 ];
		expect( call[ 0 ] ).toBe( 'import-backup-from-deeplink' );
		const payload = call[ 1 ] as { fileName: string };
		expect( payload.fileName ).not.toMatch( /[!@#\s]/ );
		expect( payload.fileName ).toMatch( /\.zip$/ );
	} );
} );
