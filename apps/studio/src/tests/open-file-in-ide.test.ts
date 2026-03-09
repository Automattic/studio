/**
 * @vitest-environment node
 */
import { exec } from 'child_process';
import { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import { readFile } from 'atomically';
import { vi } from 'vitest';
import { openFileInIDE } from 'src/ipc-handlers';
import { isInstalled } from 'src/lib/is-installed';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getUserEditor } from 'src/modules/user-settings/lib/ipc-handlers';
import { SiteServer } from 'src/site-server';

vi.mock( 'child_process', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('child_process') >();
	return {
		...actual,
		exec: vi.fn( ( _cmd: string, _opts: unknown, callback: ( err: null ) => void ) =>
			callback( null )
		),
	};
} );
vi.mock( 'fs' );
vi.mock( 'fs-extra' );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	pathExists: vi.fn().mockResolvedValue( true ),
	isWordPressDirectory: vi.fn(),
	arePathsEqual: vi.fn(),
	isEmptyDir: vi.fn(),
	calculateDirectorySizeForArchive: vi.fn(),
	recursiveCopyDirectory: vi.fn(),
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getUserDataFilePath: vi.fn().mockReturnValue( '/mock/userdata.json' ),
	getUserDataLockFilePath: vi.fn().mockReturnValue( '/mock/userdata.json.lock' ),
	getUserDataCertificatesPath: vi.fn().mockReturnValue( '/mock/certificates' ),
	getServerFilesPath: vi.fn().mockReturnValue( '/mock/server/files' ),
	getCliPath: vi.fn().mockReturnValue( '/mock/cli/path' ),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue( '/mock/node/binary' ),
	getSiteThumbnailPath: vi.fn().mockReturnValue( '/mock/thumbnail.png' ),
	DEFAULT_SITE_PATH: '/mock/default/site/path',
} ) );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/is-installed' );
vi.mock( 'src/lib/shell-open-external-wrapper' );
vi.mock( 'src/modules/user-settings/lib/ipc-handlers', () => ( {
	getUserEditor: vi.fn(),
	getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
	getInstalledAppsAndTerminals: vi.fn(),
	saveUserEditor: vi.fn(),
	saveUserTerminal: vi.fn(),
	saveUserLocale: vi.fn(),
	getUserLocale: vi.fn(),
	showUserSettings: vi.fn(),
} ) );
vi.mock( 'src/main-window' );
vi.mock( '@studio/common/lib/bump-stat' );
vi.mock( 'atomically' );
vi.mock( 'src/lib/get-image-data', () => ( {
	getImageData: vi.fn().mockResolvedValue( 'data:image/png;base64,mock' ),
} ) );
vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		getOpenPort: vi.fn().mockResolvedValue( 9999 ),
	},
} ) );

const mockUserData = { sites: [] };
if ( '__setFileContents' in fs ) {
	(
		fs as typeof fs & { __setFileContents: ( path: string, contents: string | string[] ) => void }
	 ).__setFileContents(
		normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
		JSON.stringify( mockUserData )
	);
}
vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
} as unknown as IpcMainInvokeEvent;

const mockSiteDetails = {
	id: 'site-1',
	name: 'Test Site',
	path: '/sites/test-site',
	port: 8080,
	running: true,
};

function setupMockServer() {
	vi.mocked( SiteServer.get ).mockReturnValue( {
		details: mockSiteDetails,
	} as unknown as SiteServer );
}

function getExecCalls(): string[] {
	return vi.mocked( exec ).mock.calls.map( ( call ) => call[ 0 ] as string );
}

describe( 'openFileInIDE', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		setupMockServer();
	} );

	it( 'should use the user preferred editor when set', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( 'cursor' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 2 );
		expect( calls[ 0 ] ).toContain( supportedEditorConfig.cursor.macOSBundleId );
		expect( calls[ 0 ] ).toContain( mockSiteDetails.path );
		expect( calls[ 1 ] ).toContain( supportedEditorConfig.cursor.macOSBundleId );
		expect( calls[ 1 ] ).toContain( 'wp-content/plugins/hello.php' );
	} );

	it( 'should fall back to first installed editor when no preference is set', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( null );
		vi.mocked( isInstalled ).mockImplementation( ( key ) => key === 'phpstorm' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 2 );
		expect( calls[ 0 ] ).toContain( supportedEditorConfig.phpstorm.macOSBundleId );
		expect( calls[ 1 ] ).toContain( supportedEditorConfig.phpstorm.macOSBundleId );
	} );

	it( 'should do nothing when no editor is preferred and none is installed', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( null );
		vi.mocked( isInstalled ).mockReturnValue( false );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		expect( exec ).not.toHaveBeenCalled();
	} );

	it( 'should throw when site is not found', async () => {
		vi.mocked( SiteServer.get ).mockReturnValue( undefined );

		await expect(
			openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'nonexistent' )
		).rejects.toThrow( 'Site not found.' );
	} );

	it( 'should do nothing when file does not exist in site', async () => {
		const { pathExists } = await import( '@studio/common/lib/fs-utils' );
		vi.mocked( pathExists ).mockResolvedValueOnce( false );
		vi.mocked( getUserEditor ).mockResolvedValue( 'vscode' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/nonexistent.php', 'site-1' );

		expect( exec ).not.toHaveBeenCalled();
	} );

	it( 'should respect the first editor in priority order as fallback', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( null );
		// antigravity is first in SUPPORTED_EDITORS
		vi.mocked( isInstalled ).mockImplementation(
			( key ) => key === 'antigravity' || key === 'vscode'
		);

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls[ 0 ] ).toContain( supportedEditorConfig.antigravity.macOSBundleId );
	} );

	it( 'should open site folder first, then the file', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( 'vscode' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 2 );
		// First call opens site folder
		expect( calls[ 0 ] ).toContain( mockSiteDetails.path );
		// Second call opens the specific file
		expect( calls[ 1 ] ).toContain( 'wp-content/plugins/hello.php' );
	} );
} );
