import { vi } from 'vitest';
import type { PathLike } from 'fs';

const mockFiles: Record< string, string | string[] > = {};

const readFileMock = vi.fn( async ( path: string ): Promise< string > => {
	const fileContents = mockFiles[ path ];
	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}
	return '';
} );

const readdirMock = vi.fn( async ( path: string ): Promise< string[] > => {
	const dirContents = mockFiles[ path ];
	if ( Array.isArray( dirContents ) ) {
		return dirContents;
	}
	return [];
} );

const readFileSyncMock = vi.fn( ( path: string ): string => {
	const fileContents = mockFiles[ path ];
	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}
	return '';
} );

const copyFileMock = vi.fn( async ( src: string, dest: string ) => {
	if ( ! ( src in mockFiles ) ) {
		throw new Error( `ENOENT` );
	}

	const fileContents = mockFiles[ src ];
	mockFiles[ dest ] = fileContents;

	return undefined;
} );

const watchMock = vi.fn< ( path: PathLike ) => { close: () => void } >();

const existsSyncMock = vi.fn( ( path: string ): boolean => {
	return path in mockFiles;
} );

const mkdirSyncMock = vi.fn();

const statMock = vi.fn().mockResolvedValue( {
	isDirectory: () => true,
} );

const renameMock = vi.fn().mockResolvedValue( undefined );

const __setFileContents = ( path: string, fileContents: string | string[] ) => {
	mockFiles[ path ] = fileContents;
};

const __clearMockFiles = () => {
	Object.keys( mockFiles ).forEach( ( key ) => delete mockFiles[ key ] );
};

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
	__clearMockFiles,
	__setFileContents,
	createReadStream: vi.fn(),
	createWriteStream: vi.fn(),
	existsSync: existsSyncMock,
	mkdirSync: mkdirSyncMock,
	promises: promisesMock,
	readdirSync: vi.fn(),
	readFileSync: readFileSyncMock,
	statSync: vi.fn(),
	watch: watchMock,
	writeFileSync: vi.fn(),
};

// Export named for easier access
export const existsSync = existsSyncMock;
export const mkdirSync = mkdirSyncMock;
export const promises = promisesMock;
export const readFileSync = readFileSyncMock;
export const watch = watchMock;
