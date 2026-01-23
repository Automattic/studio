import { vi } from 'vitest';

// Extend globalThis to include our mock file system
declare global {
	// eslint-disable-next-line no-var
	var __fsExtraMockFiles: Record< string, string | string[] > | undefined;
}

// Use globalThis to share state between mock and tests
// This allows tests to directly access and modify the mock file system
if ( ! globalThis.__fsExtraMockFiles ) {
	globalThis.__fsExtraMockFiles = {};
}
const mockFiles = globalThis.__fsExtraMockFiles;

const readFile = vi.fn( async ( path: string ): Promise< string > => {
	const fileContents = mockFiles[ path ];
	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}
	return '';
} );

const readFileSync = vi.fn( ( path: string ): string => {
	const fileContents = mockFiles[ path ];
	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}
	return '';
} );

const readdir = vi.fn( async ( path: string ): Promise< Array< string > > => {
	const dirContents = mockFiles[ path ];
	if ( Array.isArray( dirContents ) ) {
		return dirContents;
	}
	return [];
} );

const pathExists = vi.fn( async ( path: string ): Promise< boolean > => {
	return !! mockFiles[ path ];
} );

const mkdir = vi.fn();
const writeFile = vi.fn();
const copy = vi.fn();

const __setFileContents = ( path: string, fileContents: string | string[] ) => {
	mockFiles[ path ] = fileContents;
};

const __clearMockFiles = () => {
	Object.keys( mockFiles ).forEach( ( key ) => delete mockFiles[ key ] );
};

export default {
	__mockFiles: mockFiles,
	__setFileContents,
	__clearMockFiles,
	readFile,
	readFileSync,
	readdir,
	pathExists,
	mkdir,
	writeFile,
	copy,
};

export {
	readFile,
	readFileSync,
	readdir,
	pathExists,
	mkdir,
	writeFile,
	copy,
	__setFileContents,
	__clearMockFiles,
};
