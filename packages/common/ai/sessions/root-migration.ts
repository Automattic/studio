import fs from 'fs';
import os from 'os';
import path from 'path';
import { LOCKFILE_STALE_TIME, SESSIONS_MIGRATION_LOCKFILE_NAME } from '../../constants';
import { lockFileAsync, unlockFileAsync } from '../../lib/lockfile';
import { getConfigDirectory, getSessionsDirectory } from '../../lib/well-known-paths';
import type { Migration } from '../../lib/migration';

const SESSIONS_MIGRATION_LOCK_WAIT_TIME = 10 * 60 * 1000;

// Pre-move sessions locations: the CLI hardcoded <platform appdata>/Studio/sessions
// (the macOS path on every non-Windows platform), the desktop used Electron's
// userData, which matches except on Linux (~/.config/Studio).
function getLegacyAiSessionsRootDirectories(): string[] {
	if ( process.platform === 'win32' ) {
		return process.env.APPDATA ? [ path.join( process.env.APPDATA, 'Studio', 'sessions' ) ] : [];
	}
	const roots = [
		path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'sessions' ),
	];
	if ( process.platform === 'linux' ) {
		roots.push(
			path.join(
				process.env.XDG_CONFIG_HOME || path.join( os.homedir(), '.config' ),
				'Studio',
				'sessions'
			)
		);
	}
	return roots;
}

async function lstatIfExists( target: string ): Promise< fs.Stats | undefined > {
	try {
		return await fs.promises.lstat( target );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return undefined;
		}
		throw error;
	}
}

function normalizePathForComparison( target: string ): string {
	const normalized = path.resolve( target ).replace( /^\\\\\?\\/, '' );
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function linkPointsTo( linkPath: string, target: string ): Promise< boolean > {
	try {
		const [ linkTarget, targetPath ] = await Promise.all( [
			fs.promises.realpath( linkPath ),
			fs.promises.realpath( target ),
		] );
		return normalizePathForComparison( linkTarget ) === normalizePathForComparison( targetPath );
	} catch {
		try {
			const linkTarget = await fs.promises.readlink( linkPath );
			return (
				normalizePathForComparison( path.resolve( path.dirname( linkPath ), linkTarget ) ) ===
				normalizePathForComparison( target )
			);
		} catch {
			return false;
		}
	}
}

function sanitizeUserpath( target: string ): string {
	return target.replace( os.homedir(), '~' );
}

async function moveFile( from: string, to: string ): Promise< void > {
	try {
		await fs.promises.rename( from, to );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
			throw error;
		}
		await fs.promises.copyFile( from, to );
		await fs.promises.rm( from );
	}
}

// On a collision the destination wins and the source stays for inspection.
async function mergeDirectoryInto( source: string, destination: string ): Promise< number > {
	await fs.promises.mkdir( destination, { recursive: true } );
	let moved = 0;
	for ( const entry of await fs.promises.readdir( source, { withFileTypes: true } ) ) {
		const from = path.join( source, entry.name );
		const to = path.join( destination, entry.name );
		if ( entry.isDirectory() ) {
			moved += await mergeDirectoryInto( from, to );
		} else if ( ! fs.existsSync( to ) ) {
			await moveFile( from, to );
			moved += 1;
		}
	}
	try {
		await fs.promises.rmdir( source );
	} catch {
		// A collision or a symlink source can keep the root in place.
	}
	return moved;
}

async function removeEmptyLegacyLink( legacyRoot: string ): Promise< void > {
	const stat = await lstatIfExists( legacyRoot );
	if ( ! stat?.isSymbolicLink() ) {
		return;
	}
	try {
		if ( ( await fs.promises.readdir( legacyRoot ) ).length === 0 ) {
			await fs.promises.unlink( legacyRoot );
		}
	} catch {
		// A broken or non-directory link stays in place for inspection.
	}
}

async function linkLegacyRoot( legacyRoot: string, newRoot: string ): Promise< void > {
	try {
		await fs.promises.symlink( newRoot, legacyRoot, 'junction' );
		console.log(
			`Linked ${ sanitizeUserpath( legacyRoot ) } to ${ sanitizeUserpath(
				newRoot
			) } for older Studio versions`
		);
	} catch ( error ) {
		console.error(
			`Failed to link legacy sessions path ${ sanitizeUserpath( legacyRoot ) }:`,
			error
		);
		try {
			await fs.promises.mkdir( legacyRoot, { recursive: true } );
		} catch {
			// Current versions can still resolve moved artifacts through the path fallback.
		}
	}
}

export async function migrateLegacyAiSessionsRoot(
	newRoot: string,
	legacyRoots: string[]
): Promise< void > {
	for ( const legacyRoot of legacyRoots ) {
		try {
			const legacyStat = await lstatIfExists( legacyRoot );
			if (
				! legacyStat ||
				( legacyStat.isSymbolicLink() && ( await linkPointsTo( legacyRoot, newRoot ) ) )
			) {
				continue;
			}
			if ( ! fs.existsSync( newRoot ) ) {
				await fs.promises.mkdir( path.dirname( newRoot ), { recursive: true } );
				try {
					await fs.promises.rename( legacyRoot, newRoot );
					console.log(
						`Moved AI sessions from ${ sanitizeUserpath( legacyRoot ) } to ${ sanitizeUserpath(
							newRoot
						) }`
					);
					await linkLegacyRoot( legacyRoot, newRoot );
					continue;
				} catch ( error ) {
					if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
						throw error;
					}
				}
			}
			const moved = await mergeDirectoryInto( legacyRoot, newRoot );
			if ( moved > 0 ) {
				console.log(
					`Merged ${ moved } AI session file(s) from ${ sanitizeUserpath(
						legacyRoot
					) } into ${ sanitizeUserpath( newRoot ) }`
				);
			}
			await removeEmptyLegacyLink( legacyRoot );
			if ( ! fs.existsSync( legacyRoot ) ) {
				await linkLegacyRoot( legacyRoot, newRoot );
			}
		} catch ( error ) {
			console.error(
				`Failed to migrate AI sessions from ${ sanitizeUserpath( legacyRoot ) }:`,
				error
			);
		}
	}
}

export function resolveMigratedAiSessionsPath(
	target: string,
	newRoot = getSessionsDirectory(),
	legacyRoots = getLegacyAiSessionsRootDirectories()
): string {
	for ( const legacyRoot of legacyRoots ) {
		const relative = path.relative( legacyRoot, target );
		if (
			relative &&
			relative !== '..' &&
			! relative.startsWith( `..${ path.sep }` ) &&
			! path.isAbsolute( relative )
		) {
			return path.join( newRoot, relative );
		}
	}
	return target;
}

interface SessionsMigrationLockOptions {
	wait?: number;
	stale?: number;
	update?: number;
}

export async function withSessionsMigrationLock(
	lockPath: string,
	task: () => Promise< void >,
	options: SessionsMigrationLockOptions = {}
): Promise< void > {
	const stale = options.stale ?? LOCKFILE_STALE_TIME;
	const update = options.update ?? Math.max( 1, Math.floor( stale / 2 ) );
	await lockFileAsync( lockPath, {
		wait: options.wait ?? SESSIONS_MIGRATION_LOCK_WAIT_TIME,
		stale,
	} );
	const heartbeat = setInterval( () => {
		const now = new Date();
		void fs.promises.utimes( lockPath, now, now ).catch( () => {} );
	}, update );
	heartbeat.unref();
	try {
		await task();
	} finally {
		clearInterval( heartbeat );
		await unlockFileAsync( lockPath );
	}
}

export const moveAiSessionsToStudioDir: Migration = {
	async needsToRun() {
		if ( process.env.E2E || process.env.DEV_CONFIG_DIR ) {
			return false;
		}
		const newRoot = getSessionsDirectory();
		for ( const dir of getLegacyAiSessionsRootDirectories() ) {
			const stat = await lstatIfExists( dir );
			if ( stat && ( ! stat.isSymbolicLink() || ! ( await linkPointsTo( dir, newRoot ) ) ) ) {
				return true;
			}
		}
		return false;
	},
	async run() {
		const lockPath = path.join( getConfigDirectory(), SESSIONS_MIGRATION_LOCKFILE_NAME );
		await fs.promises.mkdir( path.dirname( lockPath ), { recursive: true } );
		await withSessionsMigrationLock( lockPath, () =>
			migrateLegacyAiSessionsRoot( getSessionsDirectory(), getLegacyAiSessionsRootDirectories() )
		);
	},
};
