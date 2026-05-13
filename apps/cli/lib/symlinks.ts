import childProcess from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { FSWatcher, watch as watchPaths } from 'chokidar';

type SymlinkWatcherEvents = {
	symlink: [ target: string, symlinkPath: string ];
	error: [ error: unknown ];
};

export class SymlinkWatcher extends EventEmitter< SymlinkWatcherEvents > {
	private watcher: FSWatcher | null = null;

	start( sitePath: string, depth: number = 2 ): void {
		if ( this.watcher ) {
			return;
		}

		this.watcher = watchPaths( sitePath, {
			// Deep watchers can easily lead to performance issues. That's why we default to a depth of 2.
			depth,
			ignoreInitial: true,
			followSymlinks: false,
			persistent: false,
			ignorePermissionErrors: true,
			// Skip directories that produce noise and never host plugin/theme symlinks.
			// chokidar v4+ no longer accepts globs by default — match against the path.
			ignored: ( entryPath: string ) =>
				/[\\/](node_modules|\.git|\.DS_Store)([\\/]|$)/.test( entryPath ),
		} );

		const onMaybeSymlink = async ( entryPath: string ) => {
			try {
				const lst = await fs.promises.lstat( entryPath );
				if ( ! lst.isSymbolicLink() ) {
					return;
				}
			} catch {
				// Entry vanished before we could inspect it.
				return;
			}

			const target = await resolveSymlinkAllowlistEntry( entryPath );
			if ( ! target ) {
				return;
			}

			this.emit( 'symlink', target, entryPath );
		};

		this.watcher.on( 'add', onMaybeSymlink );
		this.watcher.on( 'addDir', onMaybeSymlink );
		this.watcher.on( 'error', ( error ) => {
			this.emit( 'error', error );
		} );
	}

	async stop(): Promise< void > {
		await this.watcher?.close();
		this.watcher = null;
	}
}

function nativeFindSymlinksInDir( dir: string ): Promise< string[] > {
	return new Promise( ( resolve, reject ) => {
		const child = childProcess.spawn( 'find', [ dir, '-type', 'l' ] );
		let output = '';
		child.stdout.on( 'data', ( data ) => {
			output += data.toString();
		} );
		child.on( 'close', ( code ) => {
			if ( code !== 0 ) {
				reject( new Error( `find exited with code ${ code }` ) );
			} else {
				const absolutePaths = output
					.toString()
					.split( '\n' )
					.filter( Boolean )
					.map( ( relative ) => path.resolve( dir, relative ) );
				resolve( absolutePaths );
			}
		} );
		child.on( 'error', ( error ) => {
			reject( error );
		} );
	} );
}

async function walkForSymlinks( dir: string, found: string[] ): Promise< void > {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir( dir, { withFileTypes: true } );
	} catch {
		// Missing dir or denied permissions — match `find`'s behavior of just skipping.
		return;
	}
	for ( const entry of entries ) {
		const fullPath = path.join( dir, entry.name );
		if ( entry.isSymbolicLink() ) {
			found.push( fullPath );
			continue;
		}
		if ( entry.isDirectory() ) {
			await walkForSymlinks( fullPath, found );
		}
	}
}

async function findSymlinksInDir( dir: string ): Promise< string[] > {
	if ( process.platform !== 'win32' ) {
		try {
			return await nativeFindSymlinksInDir( dir );
		} catch {
			// Fall back to the Node implementation if `find` is unavailable or fails.
		}
	}

	const found: string[] = [];
	await walkForSymlinks( dir, found );
	return found;
}

// Resolve a symlink to the directory that needs to be granted in open_basedir.
// PHP's open_basedir compares against the realpath of the accessed file, so we
// follow the symlink chain and grant the containing directory of the target
// (so a single grant covers a whole symlinked plugin/theme, not just one file).
export async function resolveSymlinkAllowlistEntry( linkPath: string ): Promise< string | null > {
	try {
		const real = await fs.promises.realpath( linkPath );
		const stat = await fs.promises.stat( real );
		return stat.isDirectory() ? real : path.dirname( real );
	} catch {
		// Dangling symlink or target gone — nothing to grant.
		return null;
	}
}

export async function collectSymlinkAllowlistEntries( dir: string ): Promise< string[] > {
	const symlinks = await findSymlinksInDir( dir );
	const resolved = await Promise.all( symlinks.map( resolveSymlinkAllowlistEntry ) );
	return Array.from( new Set( resolved.filter( ( entry ): entry is string => entry !== null ) ) );
}
