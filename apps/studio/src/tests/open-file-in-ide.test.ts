/**
 * @vitest-environment node
 */
import { exec } from 'child_process';
import { IpcMainInvokeEvent } from 'electron';
import { normalize, join } from 'path';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { openAppAtPath, openFileInIDE, openTerminalAtPath } from 'src/ipc-handlers';
import { isInstalled } from 'src/lib/is-installed';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { getUserEditor, getUserTerminal } from 'src/modules/user-settings/lib/ipc-handlers';
import { linuxFindEditorPath } from 'src/modules/user-settings/lib/linux-editor-path';
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
	setTag: vi.fn(),
} ) );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/is-installed' );
vi.mock( 'src/lib/shell-open-external-wrapper' );
vi.mock( 'src/modules/user-settings/lib/win-editor-path', () => ( {
	winFindEditorPath: vi.fn().mockResolvedValue( 'C:\\mock\\editor.exe' ),
} ) );
vi.mock( 'src/modules/user-settings/lib/linux-editor-path', () => ( {
	linuxFindEditorPath: vi.fn().mockResolvedValue( '/usr/bin/code' ),
} ) );
vi.mock( 'src/modules/user-settings/lib/ipc-handlers', async () => ( {
	getUserEditor: vi.fn().mockResolvedValue( null ),
	getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
} ) );
vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
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
		vol.reset();
		vol.fromJSON( {
			[ normalize( '/path/to/app/appData/App Name/appdata-v1.json' ) ]:
				JSON.stringify( mockUserData ),
		} );
		setupMockServer();
	} );

	it( 'should use the user preferred editor when set', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( 'cursor' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 1 );
		expect( calls[ 0 ] ).toContain( mockSiteDetails.path );
		expect( calls[ 0 ] ).toContain( join( 'wp-content', 'plugins', 'hello.php' ) );
	} );

	it( 'does not record an open-in-editor Tracks event when opening a single file', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( 'cursor' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		expect( recordTracksEvent ).not.toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_OPEN_IN_EDITOR,
			expect.anything()
		);
	} );

	it( 'should fall back to first installed editor when no preference is set', async () => {
		vi.mocked( isInstalled ).mockImplementation( ( key ) => key === 'phpstorm' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 1 );
		expect( calls[ 0 ] ).toContain( mockSiteDetails.path );
		expect( calls[ 0 ] ).toContain( join( 'wp-content', 'plugins', 'hello.php' ) );
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

	it( 'should open site folder and file in a single call', async () => {
		vi.mocked( getUserEditor ).mockResolvedValue( 'vscode' );

		await openFileInIDE( mockIpcMainInvokeEvent, 'wp-content/plugins/hello.php', 'site-1' );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 1 );
		// Single call contains both site folder and file path
		expect( calls[ 0 ] ).toContain( mockSiteDetails.path );
		expect( calls[ 0 ] ).toContain( join( 'wp-content', 'plugins', 'hello.php' ) );
	} );
} );

describe( 'openAppAtPath on Linux', () => {
	const originalPlatform = process.platform;

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process, 'platform', { value: 'linux', configurable: true } );
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', {
			value: originalPlatform,
			configurable: true,
		} );
	} );

	it( 'execs the resolved editor binary with the given paths', async () => {
		vi.mocked( linuxFindEditorPath ).mockResolvedValue( '/usr/bin/code' );

		await openAppAtPath( mockIpcMainInvokeEvent, 'vscode', '/sites/test-site', [
			'/sites/test-site/wp-content/plugins/hello.php',
		] );

		const calls = getExecCalls();
		expect( calls ).toHaveLength( 1 );
		expect( calls[ 0 ] ).toContain( '"/usr/bin/code"' );
		expect( calls[ 0 ] ).toContain( '"/sites/test-site"' );
		expect( calls[ 0 ] ).toContain( '"/sites/test-site/wp-content/plugins/hello.php"' );
	} );

	it( 'does not record an open-in-editor Tracks event (it is shared with single-file opens)', async () => {
		vi.mocked( linuxFindEditorPath ).mockResolvedValue( '/usr/bin/code' );

		await openAppAtPath( mockIpcMainInvokeEvent, 'vscode', '/sites/test-site' );

		expect( recordTracksEvent ).not.toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_OPEN_IN_EDITOR,
			expect.anything()
		);
	} );

	it( 'falls back to the editor URL scheme when no binary is found', async () => {
		vi.mocked( linuxFindEditorPath ).mockResolvedValue( null );

		await openAppAtPath( mockIpcMainInvokeEvent, 'vscode', '/sites/test-site', [
			'/sites/test-site/wp-content/plugins/hello.php',
		] );

		expect( exec ).not.toHaveBeenCalled();
		expect( shellOpenExternalWrapper ).toHaveBeenCalledTimes( 2 );
		expect( shellOpenExternalWrapper ).toHaveBeenNthCalledWith(
			1,
			'vscode://file//sites/test-site?windowId=_blank'
		);
		expect( shellOpenExternalWrapper ).toHaveBeenNthCalledWith(
			2,
			'vscode://file//sites/test-site/wp-content/plugins/hello.php?windowId=_blank'
		);
	} );
} );

describe( 'openTerminalAtPath on macOS', () => {
	const originalPlatform = process.platform;

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process, 'platform', { value: 'darwin', configurable: true } );
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', {
			value: originalPlatform,
			configurable: true,
		} );
	} );

	it( 'records an open-in-terminal Tracks event with the resolved terminal', async () => {
		vi.mocked( getUserTerminal ).mockResolvedValue( 'iterm' );

		await openTerminalAtPath( mockIpcMainInvokeEvent, '/sites/test-site' );

		expect( recordTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SITE_OPEN_IN_TERMINAL, {
			terminal: 'iterm',
		} );
	} );
} );
