import { vi } from 'vitest';
import { fs as memfsFs, vol } from 'memfs';

export { vol };

// memfs uses POSIX paths; normalize Windows-style backslashes so tests work
// under the Windows platform simulation in platformTestSuite.
const toUnixPath = ( p: string | Uint8Array | URL ): string =>
	typeof p === 'string' ? p.replace( /\\/g, '/' ) : String( p );

const existsSyncMock = vi.fn( ( path: string ) => memfsFs.existsSync( toUnixPath( path ) ) );

const mkdirSyncMock = vi.fn();

const readFileSyncMock = vi.fn( ( path: string, options?: Parameters< typeof memfsFs.readFileSync >[ 1 ] ) =>
	memfsFs.readFileSync( toUnixPath( path ), options ) as string
);

const readdirSyncMock = vi.fn( ( ...args: Parameters< typeof memfsFs.readdirSync > ) =>
	memfsFs.readdirSync( ...args ) as string[]
);

const statSyncMock = vi.fn( ( path: string ) => memfsFs.statSync( path ) );

const watchMock = vi.fn( ( ...args: Parameters< typeof memfsFs.watch > ) =>
	memfsFs.watch( ...args )
);

const copyFileMock = vi.fn( async ( src: string, dest: string ) =>
	memfsFs.promises.copyFile( src, dest )
);

const readdirMock = vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readdir > ) =>
	memfsFs.promises.readdir( ...args )
);

const readFileMock = vi.fn( ( path: string | Uint8Array | URL, options?: Parameters< typeof memfsFs.promises.readFile >[ 1 ] ) =>
	memfsFs.promises.readFile( toUnixPath( path ), options as Parameters< typeof memfsFs.promises.readFile >[ 1 ] )
);

const renameMock = vi.fn( async ( oldPath: string, newPath: string ) =>
	memfsFs.promises.rename( oldPath, newPath )
);

const statMock = vi.fn( ( path: string ) => memfsFs.promises.stat( path ) );

const promisesMock = {
	cp: vi.fn(),
	copyFile: copyFileMock,
	mkdir: vi.fn(),
	mkdtemp: vi.fn(),
	readdir: readdirMock,
	readFile: readFileMock,
	rename: renameMock,
	rm: vi.fn(),
	stat: statMock,
	symlink: vi.fn(),
	unlink: vi.fn(),
	writeFile: vi.fn(),
};

export default {
	createReadStream: vi.fn(),
	createWriteStream: vi.fn(),
	existsSync: existsSyncMock,
	mkdirSync: mkdirSyncMock,
	promises: promisesMock,
	readdirSync: readdirSyncMock,
	readFileSync: readFileSyncMock,
	statSync: statSyncMock,
	unlinkSync: vi.fn(),
	watch: watchMock,
	writeFileSync: vi.fn(),
};

export const existsSync = existsSyncMock;
export const mkdirSync = mkdirSyncMock;
export const promises = promisesMock;
export const readFileSync = readFileSyncMock;
export const watch = watchMock;
