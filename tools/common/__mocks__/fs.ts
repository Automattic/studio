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

const statMock = vi.fn().mockResolvedValue( {
	isDirectory: () => true,
} );

const __setFileContents = ( path: string, fileContents: string | string[] ) => {
	mockFiles[ path ] = fileContents;
};

const __clearMockFiles = () => {
	Object.keys( mockFiles ).forEach( ( key ) => delete mockFiles[ key ] );
};

export default {
	promises: {
		copyFile: copyFileMock,
		mkdir: vi.fn().mockResolvedValue( undefined ),
		readFile: readFileMock,
		readdir: readdirMock,
		stat: statMock,
		writeFile: vi.fn().mockResolvedValue( undefined ),
	},
	readFileSync: readFileSyncMock,
	watch: watchMock,
	existsSync: existsSyncMock,
	__setFileContents,
	__clearMockFiles,
};

// Export named for easier access
export const promises = {
	readFile: readFileMock,
	readdir: readdirMock,
	stat: statMock,
};
export const readFileSync = readFileSyncMock;
export const watch = watchMock;
export const existsSync = existsSyncMock;
