/// <reference types="vitest/globals" />

import { fs as memfsFs, vol } from 'memfs';

export { vol };

const move = vi.fn( async ( source: string, destination: string ): Promise< void > => {
	try {
		memfsFs.renameSync( source, destination );
	} catch {
		// Source may not be in vol — fall through silently
	}
} );

const remove = vi.fn( async ( path: string ): Promise< void > => {
	try {
		const stat = memfsFs.statSync( path );
		if ( stat.isDirectory() ) {
			memfsFs.rmdirSync( path, { recursive: true } );
		} else {
			memfsFs.unlinkSync( path );
		}
	} catch {
		// Ignore ENOENT — same behaviour as fs-extra's remove
	}
} );

const readFile = vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readFile > ) =>
	memfsFs.promises.readFile( ...args )
);

const readFileSync = vi.fn( ( ...args: Parameters< typeof memfsFs.readFileSync > ) =>
	memfsFs.readFileSync( ...args )
);

const readdir = vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readdir > ) =>
	memfsFs.promises.readdir( ...args )
);

const pathExists = vi.fn( async ( path: string ): Promise< boolean > => {
	return memfsFs.existsSync( path );
} );

const ensureDir = vi.fn();
const mkdir = vi.fn();
const readJson = vi.fn();
const writeFile = vi.fn();
const writeJson = vi.fn();
const copy = vi.fn();
const lstat = vi.fn();

export default {
	copy,
	ensureDir,
	lstat,
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
	copy,
	ensureDir,
	lstat,
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
