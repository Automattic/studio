/// <reference types="vitest/globals" />

import { fs as memfsFs } from 'memfs';

type NormalizePath = ( p: string | Uint8Array | URL ) => string;

const identity: NormalizePath = ( p ) => ( typeof p === 'string' ? p : String( p ) );

export function createFsMock( normalizePath: NormalizePath = identity ) {
	const createReadStream = vi.fn();
	const createWriteStream = vi.fn();

	const existsSync = vi.fn( ( path: string ) => memfsFs.existsSync( normalizePath( path ) ) );

	const mkdirSync = vi.fn();

	const readFileSync = vi.fn(
		( path: string, options?: Parameters< typeof memfsFs.readFileSync >[ 1 ] ) =>
			memfsFs.readFileSync( normalizePath( path ), options ) as string
	);

	const readdirSync = vi.fn(
		( ...args: Parameters< typeof memfsFs.readdirSync > ) =>
			memfsFs.readdirSync( ...args ) as string[]
	);

	const statSync = vi.fn( ( path: string ) => memfsFs.statSync( path ) );

	const unlinkSync = vi.fn();

	const watch = vi.fn( ( ...args: Parameters< typeof memfsFs.watch > ) =>
		memfsFs.watch( ...args )
	);

	const writeFileSync = vi.fn();

	const promises = {
		cp: vi.fn(),
		copyFile: vi.fn( async ( src: string, dest: string ) =>
			memfsFs.promises.copyFile( src, dest )
		),
		mkdir: vi.fn(),
		mkdtemp: vi.fn(),
		readdir: vi.fn( ( ...args: Parameters< typeof memfsFs.promises.readdir > ) =>
			memfsFs.promises.readdir( ...args )
		),
		readFile: vi.fn(
			(
				path: string | Uint8Array | URL,
				options?: Parameters< typeof memfsFs.promises.readFile >[ 1 ]
			) =>
				memfsFs.promises.readFile(
					normalizePath( path ),
					options as Parameters< typeof memfsFs.promises.readFile >[ 1 ]
				)
		),
		rename: vi.fn( async ( oldPath: string, newPath: string ) =>
			memfsFs.promises.rename( oldPath, newPath )
		),
		rm: vi.fn(),
		stat: vi.fn( ( path: string ) => memfsFs.promises.stat( path ) ),
		symlink: vi.fn(),
		unlink: vi.fn(),
		writeFile: vi.fn(),
	};

	return {
		createReadStream,
		createWriteStream,
		existsSync,
		mkdirSync,
		promises,
		readFile: vi.fn(),
		readdirSync,
		readFileSync,
		statSync,
		unlinkSync,
		watch,
		writeFile: vi.fn(),
		writeFileSync,
	};
}
