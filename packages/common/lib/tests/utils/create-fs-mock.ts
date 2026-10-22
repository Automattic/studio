/// <reference types="vitest/globals" />

import { fs as memfsFs } from 'memfs';

// Explicit so the inferred return type doesn't reference Vitest's internal `Procedure` type.
type UntypedFn = ( ...args: any[] ) => unknown;

type NormalizePath = ( p: string | Uint8Array | URL ) => string;

const identity: NormalizePath = ( p ) => ( typeof p === 'string' ? p : String( p ) );

export function createFsMock( normalizePath: NormalizePath = identity ) {
	const createReadStream = vi.fn< UntypedFn >();
	const createWriteStream = vi.fn< UntypedFn >();

	const existsSync = vi.fn( ( path: string ) => memfsFs.existsSync( normalizePath( path ) ) );

	const mkdirSync = vi.fn< UntypedFn >();

	const readFileSync = vi.fn(
		( path: string, options?: Parameters< typeof memfsFs.readFileSync >[ 1 ] ) =>
			memfsFs.readFileSync( normalizePath( path ), options ) as string
	);

	const readdirSync = vi.fn(
		( ...args: Parameters< typeof memfsFs.readdirSync > ) =>
			memfsFs.readdirSync( ...args ) as string[]
	);

	const statSync = vi.fn( ( path: string ) => memfsFs.statSync( path ) );

	const unlinkSync = vi.fn< UntypedFn >();

	const watch = vi.fn( ( ...args: Parameters< typeof memfsFs.watch > ) =>
		memfsFs.watch( ...args )
	);

	const writeFileSync = vi.fn< UntypedFn >();

	const promises = {
		cp: vi.fn< UntypedFn >(),
		copyFile: vi.fn( async ( src: string, dest: string ) =>
			memfsFs.promises.copyFile( src, dest )
		),
		mkdir: vi.fn< UntypedFn >(),
		mkdtemp: vi.fn< UntypedFn >(),
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
		rm: vi.fn< UntypedFn >(),
		stat: vi.fn( ( path: string ) => memfsFs.promises.stat( path ) ),
		symlink: vi.fn< UntypedFn >(),
		unlink: vi.fn< UntypedFn >(),
		writeFile: vi.fn< UntypedFn >(),
	};

	return {
		createReadStream,
		createWriteStream,
		existsSync,
		mkdirSync,
		promises,
		readFile: vi.fn< UntypedFn >(),
		readdirSync,
		readFileSync,
		statSync,
		unlinkSync,
		watch,
		writeFile: vi.fn< UntypedFn >(),
		writeFileSync,
	};
}
