import { vi } from 'vitest';

const mockFiles: Record< string, string | string[] > = {};

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

export default {
	__mockFiles: mockFiles,
	__setFileContents,
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
};
