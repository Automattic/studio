/**
 * @vitest-environment node
 */
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prunePmLogs } from 'cli/lib/prune-pm-logs';

const { pmHome } = vi.hoisted( () => {
	const fsMod = require( 'fs' ) as typeof import('fs');

	const osMod = require( 'os' ) as typeof import('os');

	const pathMod = require( 'path' ) as typeof import('path');
	const home = fsMod.mkdtempSync( pathMod.join( osMod.tmpdir(), 'studio-pm-logs-test-' ) );
	process.env.STUDIO_PROCESS_MANAGER_HOME = home;
	return { pmHome: home };
} );

const logsDir = path.join( pmHome, 'logs' );
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateTag( date: Date ): string {
	const year = date.getFullYear();
	const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const day = String( date.getDate() ).padStart( 2, '0' );
	return `${ year }${ month }${ day }`;
}

function writeFile( name: string, mtime?: Date ) {
	const fullPath = path.join( logsDir, name );
	fs.writeFileSync( fullPath, 'log content' );
	if ( mtime ) {
		fs.utimesSync( fullPath, mtime, mtime );
	}
	return fullPath;
}

function daysAgo( days: number ): Date {
	return new Date( Date.now() - days * MS_PER_DAY );
}

beforeEach( () => {
	fs.rmSync( logsDir, { recursive: true, force: true } );
	fs.mkdirSync( logsDir, { recursive: true } );
} );

afterEach( () => {
	fs.rmSync( logsDir, { recursive: true, force: true } );
} );

describe( 'prunePmLogs', () => {
	it( 'deletes dated logs whose mtime is past the retention window', async () => {
		const stale = writeFile( `site-out-${ dateTag( daysAgo( 1 ) ) }.log`, daysAgo( 30 ) );
		const fresh = writeFile( `other-out-${ dateTag( daysAgo( 1 ) ) }.log`, daysAgo( 1 ) );

		await prunePmLogs();

		expect( fs.existsSync( stale ) ).toBe( false );
		expect( fs.existsSync( fresh ) ).toBe( true );
	} );

	it( 'deletes legacy undated logs whose mtime is past the retention window', async () => {
		const stale = writeFile( 'site-out.log', daysAgo( 30 ) );
		const fresh = writeFile( 'site-error.log', daysAgo( 1 ) );

		await prunePmLogs();

		expect( fs.existsSync( stale ) ).toBe( false );
		expect( fs.existsSync( fresh ) ).toBe( true );
	} );

	it( 'preserves actively-written files regardless of the filename date tag', async () => {
		// Simulates a long-running session: date tag is very old but mtime is fresh.
		const active = writeFile( `long-running-out-${ dateTag( daysAgo( 60 ) ) }.log`, daysAgo( 0 ) );
		await prunePmLogs();
		expect( fs.existsSync( active ) ).toBe( true );
	} );

	it( 'ignores files that do not match the log filename pattern', async () => {
		const unrelated = writeFile( 'random-file.txt', daysAgo( 30 ) );
		const auditFile = writeFile( 'log-audit.json', daysAgo( 30 ) );

		await prunePmLogs();

		expect( fs.existsSync( unrelated ) ).toBe( true );
		expect( fs.existsSync( auditFile ) ).toBe( true );
	} );

	it( 'handles multi-hyphen process names', async () => {
		const stale = writeFile(
			`my-site-with-dashes-out-${ dateTag( daysAgo( 1 ) ) }.log`,
			daysAgo( 30 )
		);
		const fresh = writeFile( 'my-site-with-dashes-error.log', daysAgo( 1 ) );

		await prunePmLogs();

		expect( fs.existsSync( stale ) ).toBe( false );
		expect( fs.existsSync( fresh ) ).toBe( true );
	} );

	it( 'is a no-op when the logs directory does not exist', async () => {
		fs.rmSync( logsDir, { recursive: true, force: true } );
		await expect( prunePmLogs() ).resolves.toBeUndefined();
	} );
} );
