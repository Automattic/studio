import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { FSWatcher, watch as watchPaths } from 'chokidar';

type SymlinkWatcherEvents = {
	symlink: [ target: string, symlinkPath: string ];
	error: [ error: unknown ];
	unrecoverable: [ error: unknown ];
	restart: [];
};

// Backoff schedule for self-heal attempts after the chokidar watcher errors.
// The 0th index is used for the first attempt; subsequent attempts use later
// indexes, with the last value repeated if attempts exceed the array length.
const RESTART_BACKOFF_MS = [ 500, 1000, 2000, 4000, 8000 ];
// Max number of self-heal attempts allowed within RESTART_BUDGET_WINDOW_MS
// before we stop trying and emit an 'unrecoverable' event. Tuned to absorb a
// blueprint-apply burst (which typically resolves within a few seconds) without
// looping forever against a permanently broken watch handle.
const RESTART_BUDGET = 5;
const RESTART_BUDGET_WINDOW_MS = 60_000;

// Directories that never host plugin/theme symlinks but can hold thousands of
// them (npm/pnpm link farms).
const IGNORED_SCAN_DIRECTORY_NAMES = new Set( [ 'node_modules', '.git', '.DS_Store' ] );
// chokidar hands `ignored` a full path, so there the same names match per segment.
const IGNORED_SCAN_PATH = /[\\/](node_modules|\.git|\.DS_Store)([\\/]|$)/;

// Directory levels below the scan root to descend into; an entry sitting directly
// in the root has depth 1. Equivalent to the watcher's chokidar `depth: 2` rooted
// at wp-content, i.e. site/wp-content/themes/my-theme/<entry>.
export const SYMLINK_SCAN_DEPTH = 4;

export class SymlinkWatcher extends EventEmitter< SymlinkWatcherEvents > {
	private watcher: FSWatcher | null = null;
	private watchPath: string | null = null;
	private depth: number = 2;
	private restartTimestamps: number[] = [];
	private restartTimer: NodeJS.Timeout | null = null;
	private stopped = false;

	start( watchPath: string, depth: number = 2 ): void {
		if ( this.watcher ) {
			return;
		}
		this.watchPath = watchPath;
		this.depth = depth;
		this.stopped = false;
		this.restartTimestamps = [];
		this.attachWatcher();
	}

	async stop(): Promise< void > {
		this.stopped = true;
		if ( this.restartTimer ) {
			clearTimeout( this.restartTimer );
			this.restartTimer = null;
		}
		this.restartTimestamps = [];
		this.watchPath = null;
		const watcher = this.watcher;
		this.watcher = null;
		if ( watcher ) {
			try {
				await watcher.close();
			} catch {
				// Best effort — the underlying handle may already be dead.
			}
		}
	}

	private attachWatcher(): void {
		if ( ! this.watchPath || this.stopped ) {
			return;
		}

		const watcher = watchPaths( this.watchPath, {
			// Deep watchers can easily lead to performance issues. That's why we default to a depth of 2.
			depth: this.depth,
			ignoreInitial: true,
			followSymlinks: false,
			// `persistent: true` is required so chokidar wires an 'error' listener on the
			// underlying native FSWatcher (see chokidar handler.js setFsWatchListener)
			persistent: true,
			ignorePermissionErrors: true,
			// Skip directories that produce noise and never host plugin/theme symlinks.
			// chokidar v4+ no longer accepts globs by default — match against the path.
			ignored: ( entryPath: string ) => IGNORED_SCAN_PATH.test( entryPath ),
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

		watcher.on( 'add', onMaybeSymlink );
		watcher.on( 'addDir', onMaybeSymlink );
		watcher.on( 'error', ( error ) => {
			// Surface the error so the caller can log it, then try to recover. The
			// most common trigger on Windows is a transient EPERM during heavy
			// directory churn (e.g. blueprint apply extracting plugins/themes).
			this.emit( 'error', error );
			this.scheduleRestart();
		} );

		this.watcher = watcher;
	}

	private scheduleRestart(): void {
		if ( this.stopped || this.restartTimer ) {
			return;
		}

		const now = Date.now();
		this.restartTimestamps = this.restartTimestamps.filter(
			( ts ) => now - ts < RESTART_BUDGET_WINDOW_MS
		);

		if ( this.restartTimestamps.length >= RESTART_BUDGET ) {
			const error = new Error(
				`Symlink watcher gave up after ${ RESTART_BUDGET } restart attempts within ${
					RESTART_BUDGET_WINDOW_MS / 1000
				}s. Future symlinks under the site directory will not be auto-allowed; restart the site to recover.`
			);
			this.emit( 'unrecoverable', error );
			// Tear down so we stop reacting to further events. start() must be
			// called again to resume watching.
			this.stopped = true;
			const watcher = this.watcher;
			this.watcher = null;
			if ( watcher ) {
				watcher.close().catch( () => {} );
			}
			return;
		}

		const attempt = this.restartTimestamps.length;
		this.restartTimestamps.push( now );

		const delay = RESTART_BACKOFF_MS[ Math.min( attempt, RESTART_BACKOFF_MS.length - 1 ) ];
		this.restartTimer = setTimeout( () => {
			this.restartTimer = null;
			void this.restartNow();
		}, delay );
	}

	private async restartNow(): Promise< void > {
		if ( this.stopped ) {
			return;
		}

		const previousWatcher = this.watcher;
		this.watcher = null;
		if ( previousWatcher ) {
			try {
				// Awaiting close lets chokidar release its cached FsWatchInstance for
				// this path. If we re-watched while close was still pending, chokidar
				// would attach our new listener to the existing (already-broken)
				// instance and we would never recover.
				await previousWatcher.close();
			} catch {
				// Best effort.
			}
		}

		if ( this.stopped ) {
			return;
		}

		this.attachWatcher();

		// Notify the caller that the watcher was reattached. Events fired during
		// the dead window are lost, so the caller is responsible for re-scanning
		// the tree and reconciling any new state.
		this.emit( 'restart' );
	}
}

async function walkForSymlinks(
	dir: string,
	found: string[],
	depth: number,
	maxDepth: number
): Promise< void > {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir( dir, { withFileTypes: true } );
	} catch {
		// Missing dir or denied permissions — skip it rather than failing the scan.
		return;
	}
	for ( const entry of entries ) {
		if ( IGNORED_SCAN_DIRECTORY_NAMES.has( entry.name ) ) {
			continue;
		}
		const fullPath = path.join( dir, entry.name );
		if ( entry.isSymbolicLink() ) {
			found.push( fullPath );
			continue;
		}
		if ( entry.isDirectory() && depth < maxDepth ) {
			await walkForSymlinks( fullPath, found, depth + 1, maxDepth );
		}
	}
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

export async function collectSymlinkAllowlistEntries(
	dir: string,
	maxDepth: number = SYMLINK_SCAN_DEPTH
): Promise< string[] > {
	const symlinks: string[] = [];
	await walkForSymlinks( dir, symlinks, 1, maxDepth );
	const resolved = await Promise.all( symlinks.map( resolveSymlinkAllowlistEntry ) );
	return Array.from( new Set( resolved.filter( ( entry ): entry is string => entry !== null ) ) );
}
