/// <reference types="vitest/globals" />

import { fs as memfsFs, vol } from 'memfs';

export { vol };

const existsSyncMock = vi.fn( ( path: string ) => memfsFs.existsSync( path ) );

const mkdirSyncMock = vi.fn();

const readFileSyncMock = vi.fn( ( path: string, options?: Parameters< typeof memfsFs.readFileSync >[ 1 ] ) =>
	memfsFs.readFileSync( path, options ) as string
);

const readdirSyncMock = vi.fn();

const statSyncMock = vi.fn( ( path: string ) => memfsFs.statSync( path ) );

const watchMock = vi.fn( ( ...args: Parameters< typeof memfsFs.watch > ) =>
	memfsFs.watch( ...args )
);

const readdirMock = vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readdir > ) =>
	memfsFs.promises.readdir( ...args )
);

const readFileMock = vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readFile > ) =>
	memfsFs.promises.readFile( ...args )
);

const renameMock = vi.fn();

const statMock = vi.fn( ( path: string ) => memfsFs.promises.stat( path ) );

const promisesMock = {
	cp: vi.fn(),
	copyFile: vi.fn(),
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
