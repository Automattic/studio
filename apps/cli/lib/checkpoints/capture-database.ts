import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { getStoreTmpDirectory } from './manifest';
import { CHECKPOINT_TEMP_FILE_PREFIX } from './walker';
import type { SiteData } from 'cli/lib/cli-config/core';

export const SITE_DATABASE_RELATIVE_PATH = path.join( 'wp-content', 'database', '.ht.sqlite' );

export interface DatabaseCaptureResult {
	// Consolidated, integrity-verified database file. Lives in the store's tmp
	// directory; the caller stores it as an object and removes it.
	capturedPath: string;
	capture: 'vacuum' | 'file-copy';
}

interface SqliteDatabase {
	exec( sql: string ): void;
	prepare( sql: string ): { get(): Record< string, unknown > | undefined };
	close(): void;
}

// `node:sqlite` is available in the runtimes Studio ships (Node >= 22 for the
// CLI, Electron 41 = Node 24), but load it dynamically so environments
// without it degrade gracefully instead of failing at import time.
async function openSqlite( filePath: string ): Promise< SqliteDatabase | undefined > {
	try {
		const sqlite = await import( 'node:sqlite' );
		return new sqlite.DatabaseSync( filePath ) as unknown as SqliteDatabase;
	} catch ( error ) {
		return undefined;
	}
}

// IMPORTANT: only ever call on checkpoint artifacts/copies, never on a live
// site database — host-process SQLite locks don't coordinate with the
// runtimes that serve the site.
export async function verifySqliteIntegrity( filePath: string ): Promise< boolean > {
	const db = await openSqlite( filePath );
	if ( ! db ) {
		// Without node:sqlite we can't verify; treat as passing so capture
		// still works, relying on retries having nothing to detect failures.
		return true;
	}
	try {
		const row = db.prepare( 'PRAGMA integrity_check' ).get();
		return row !== undefined && Object.values( row )[ 0 ] === 'ok';
	} catch ( error ) {
		return false;
	} finally {
		db.close();
	}
}

// Folds any WAL residue on a database COPY into its main file so the stored
// artifact is a single self-contained .sqlite file.
async function consolidateWal( copyPath: string ): Promise< void > {
	const db = await openSqlite( copyPath );
	if ( ! db ) {
		return;
	}
	try {
		db.exec( 'PRAGMA wal_checkpoint(TRUNCATE)' );
	} finally {
		db.close();
	}
	await fsPromises.rm( `${ copyPath }-wal`, { force: true } );
	await fsPromises.rm( `${ copyPath }-shm`, { force: true } );
}

async function captureFromStoppedSite( site: SiteData ): Promise< string > {
	const sourcePath = path.join( site.path, SITE_DATABASE_RELATIVE_PATH );
	if ( ! fs.existsSync( sourcePath ) ) {
		throw new Error( __( 'The site has no SQLite database to capture.' ) );
	}

	const destinationPath = path.join(
		getStoreTmpDirectory( site.id ),
		`db-${ crypto.randomUUID() }.sqlite`
	);

	// Copy the database and any WAL residue as a pair (a crashed or
	// force-stopped server can leave unmerged frames in the -wal file), then
	// fold the WAL into the copy so the artifact is one file.
	await fsPromises.copyFile( sourcePath, destinationPath, fs.constants.COPYFILE_FICLONE );
	if ( fs.existsSync( `${ sourcePath }-wal` ) ) {
		await fsPromises.copyFile(
			`${ sourcePath }-wal`,
			`${ destinationPath }-wal`,
			fs.constants.COPYFILE_FICLONE
		);
	}
	await consolidateWal( destinationPath );

	return destinationPath;
}

// Captures the database of a RUNNING site by executing `VACUUM INTO` from a
// PHP process appropriate to the site's runtime:
//  - native: a separate wp-cli PHP process; POSIX locks coordinate with the
//    server's PHP, so the copy is transactionally consistent.
//  - sandbox (Playground): routed into the running daemon over IPC. The
//    daemon may still run wp-cli commands in parallel WASM instances whose
//    SQLite locks do NOT coordinate, so the artifact is verified host-side
//    and the capture retried on failure.
// `--skip-wordpress` keeps WordPress (and the SQLite integration's own
// connection) out of the eval entirely; paths are relative to the PHP cwd,
// which is the site root for native and /wordpress for the sandbox.
async function captureFromRunningSite( site: SiteData ): Promise< string > {
	const tempFileName = `${ CHECKPOINT_TEMP_FILE_PREFIX }db-${ crypto.randomUUID() }.sqlite`;
	const relativeSource = 'wp-content/database/.ht.sqlite';
	const phpCode = [
		'error_reporting(0);',
		`$src = getcwd() . '/${ relativeSource }';`,
		`$dst = getcwd() . '/${ tempFileName }';`,
		'try {',
		'$pdo = new PDO("sqlite:$src");',
		'$pdo->exec("VACUUM INTO " . $pdo->quote($dst));',
		'echo "studio-checkpoint-capture-ok";',
		'} catch (Throwable $e) { echo "studio-checkpoint-capture-error: " . $e->getMessage(); }',
	].join( ' ' );

	await using command = await runWpCliCommandWithMessaging(
		site,
		[ 'eval', phpCode, '--skip-wordpress' ],
		{ phpVersion: validatePhpVersion( site.phpVersion ) }
	);
	const stdout = await command.response.stdoutText;
	const hostTempPath = path.join( site.path, tempFileName );

	if ( ! stdout.includes( 'studio-checkpoint-capture-ok' ) || ! fs.existsSync( hostTempPath ) ) {
		await fsPromises.rm( hostTempPath, { force: true } );
		throw new Error(
			sprintf( __( 'Database capture failed: %s' ), stdout.trim() || __( 'no output' ) )
		);
	}

	// Move the artifact out of the site tree into the store's tmp directory.
	const destinationPath = path.join(
		getStoreTmpDirectory( site.id ),
		`db-${ crypto.randomUUID() }.sqlite`
	);
	await fsPromises.rename( hostTempPath, destinationPath ).catch( async () => {
		// Cross-device fallback (site and store on different volumes).
		await fsPromises.copyFile( hostTempPath, destinationPath );
		await fsPromises.rm( hostTempPath, { force: true } );
	} );

	return destinationPath;
}

const RUNNING_CAPTURE_ATTEMPTS = 3;

export async function captureDatabase(
	site: SiteData,
	isRunning: boolean
): Promise< DatabaseCaptureResult > {
	await fsPromises.mkdir( getStoreTmpDirectory( site.id ), { recursive: true } );

	if ( ! isRunning ) {
		const capturedPath = await captureFromStoppedSite( site );
		if ( ! ( await verifySqliteIntegrity( capturedPath ) ) ) {
			await fsPromises.rm( capturedPath, { force: true } );
			throw new Error( __( 'The captured database copy failed its integrity check.' ) );
		}
		return { capturedPath, capture: 'file-copy' };
	}

	let lastError: unknown;
	for ( let attempt = 1; attempt <= RUNNING_CAPTURE_ATTEMPTS; attempt++ ) {
		let capturedPath: string | undefined;
		try {
			capturedPath = await captureFromRunningSite( site );
			if ( await verifySqliteIntegrity( capturedPath ) ) {
				return { capturedPath, capture: 'vacuum' };
			}
			lastError = new Error( __( 'The captured database copy failed its integrity check.' ) );
			await fsPromises.rm( capturedPath, { force: true } );
		} catch ( error ) {
			lastError = error;
			if ( capturedPath ) {
				await fsPromises.rm( capturedPath, { force: true } );
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error( __( 'Database capture failed after multiple attempts.' ) );
}
