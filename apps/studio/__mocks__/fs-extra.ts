/// <reference types="vitest/globals" />

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

const move = vi.fn( async ( source: string, destination: string ): Promise< void > => {
	mockFiles[ destination ] = mockFiles[ source ];
	delete mockFiles[ source ];
} );

const remove = vi.fn( async ( path: string ): Promise< void > => {
	delete mockFiles[ path ];
} );

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
const readJson = vi.fn();
const writeFile = vi.fn();
const writeJson = vi.fn();
const copy = vi.fn();

const __setFileContents = ( path: string, fileContents: string | string[] ) => {
	mockFiles[ path ] = fileContents;
};

const __clearMockFiles = () => {
	Object.keys( mockFiles ).forEach( ( key ) => delete mockFiles[ key ] );
};

export default {
	__clearMockFiles,
	__mockFiles: mockFiles,
	__setFileContents,
	copy,
	mkdir,
	move,
	pathExists,
	readdir,
	readFile,
	readFileSync,
	readJson,
	remove,
	writeFile,
	writeJson,
};

export {
	__clearMockFiles,
	__setFileContents,
	copy,
	mkdir,
	move,
	pathExists,
	readdir,
	readFile,
	readFileSync,
	readJson,
	remove,
	writeFile,
	writeJson,
};
