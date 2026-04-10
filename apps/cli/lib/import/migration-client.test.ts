import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	applyIndexedEntryProgress,
	formatImporterJsonlProgress,
	formatImporterProgressSnapshot,
	ImporterIndexProgressTracker,
	rewriteImporterArgsForNativePhp,
	updateImporterProgressSnapshot,
} from './migration-client';

function encodePathKey( filePath: string ): string {
	return Buffer.from( filePath ).toString( 'base64' );
}

function buildIndexLine( filePath: string ): string {
	return JSON.stringify( {
		path: encodePathKey( filePath ),
		ctime: 1,
		size: 0,
		type: 'file',
	} );
}

function buildUpdateLine( filePath: string, op: 'F' | 'D' ): string {
	return JSON.stringify( {
		op,
		path: encodePathKey( filePath ),
	} );
}

describe( 'formatImporterJsonlProgress', () => {
	it( 'suppresses debug messages from the importer', () => {
		expect(
			formatImporterJsonlProgress(
				{ debug: 'Waiting for server response...' },
				'Downloading essential files',
				3
			)
		).toBeNull();
	} );

	it( 'suppresses bare phase-only records without additional data', () => {
		expect(
			formatImporterJsonlProgress( { phase: 'index' }, 'Downloading essential files', 7 )
		).toBeNull();
	} );

	it( 'formats streamed file and byte counts when present', () => {
		expect(
			formatImporterJsonlProgress(
				{
					downloaded_files: 42,
					total_files: 100,
					downloaded_bytes: 1024 * 1024 * 12.5,
					total_bytes: 1024 * 1024 * 50,
				},
				'Downloading essential files',
				12
			)
		).toBe( 'Downloading essential files · 42/100 files · 12.5 MB/50.0 MB · 12s' );
	} );

	it( 'falls back to a generic progress message when only a message field is available', () => {
		expect(
			formatImporterJsonlProgress(
				{
					message: 'Downloading file batches',
				},
				'Downloading essential files',
				9
			)
		).toBe( 'Downloading essential files · Downloading file batches · 9s' );
	} );

	it( 'formats heartbeat and progress-check records as byte progress', () => {
		const heartbeatSnapshot = updateImporterProgressSnapshot( {
			heartbeat: true,
			bytes_received: 1024 * 1024 * 6,
		} );
		expect(
			formatImporterProgressSnapshot( heartbeatSnapshot!, 'Downloading essential files', 4 )
		).toBe( 'Downloading essential files · 6.0 MB received · 4s' );

		const progressSnapshot = updateImporterProgressSnapshot(
			{
				progress_check: true,
				bytes_received: 1024 * 1024 * 8,
				rate_bps: 1024 * 512,
			},
			heartbeatSnapshot!
		);
		expect(
			formatImporterProgressSnapshot( progressSnapshot!, 'Downloading essential files', 5 )
		).toBe( 'Downloading essential files · 8.0 MB received · 5s' );
	} );

	it( 'accumulates bytes across request restarts when the importer heartbeat resets', () => {
		const firstRequest = updateImporterProgressSnapshot( {
			heartbeat: true,
			bytes_received: 1024 * 1024 * 6,
		} );
		const secondRequest = updateImporterProgressSnapshot(
			{
				type: 'symlink_follow',
				directory: '/wordpress/plugins/jetpack/15.7-a.7',
			},
			firstRequest!
		);
		const restartedHeartbeat = updateImporterProgressSnapshot(
			{
				heartbeat: true,
				bytes_received: 1024 * 512,
			},
			secondRequest!
		);

		expect(
			formatImporterProgressSnapshot( restartedHeartbeat!, 'Downloading essential files', 7 )
		).toBe(
			'Indexing remote files · 6.5 MB received · following symlink .../plugins/jetpack/15.7-a.7 · 7s'
		);
	} );

	it( 'uses raw file and byte counts without accumulating across restarts', () => {
		const first = updateImporterProgressSnapshot( {
			downloaded_files: 42,
			total_files: 100,
			downloaded_bytes: 1024 * 1024 * 12,
			total_bytes: 1024 * 1024 * 50,
		} );
		// Importer restarts — files_done drops because files_imported resets
		// before the batch offset advances.  The high-water mark holds so the
		// displayed count never goes backward.
		const afterRestart = updateImporterProgressSnapshot(
			{
				downloaded_files: 5,
				downloaded_bytes: 1024 * 1024 * 2,
			},
			first!
		);

		expect( afterRestart!.downloadedFiles ).toBe( 42 );
		expect( afterRestart!.downloadedBytes ).toBe( 1024 * 1024 * 12 );
		expect( afterRestart!.totalFiles ).toBe( 100 );
		expect( formatImporterProgressSnapshot( afterRestart!, 'Essential files', 20 ) ).toBe(
			'Essential files · 42/100 files · 12.0 MB/50.0 MB · 20s'
		);
	} );

	it( 'always uses the latest files_total from the importer', () => {
		const first = updateImporterProgressSnapshot( {
			total_files: 200,
		} );
		const updated = updateImporterProgressSnapshot( { total_files: 300 }, first! );
		expect( updated!.totalFiles ).toBe( 300 );
	} );

	it( 'applies exact indexed progress from the local importer index', () => {
		const staleSnapshot = updateImporterProgressSnapshot( {
			files_done: 12000,
			files_total: 78000,
		} );

		const repairedSnapshot = applyIndexedEntryProgress( staleSnapshot!, 18500 );

		expect( repairedSnapshot.downloadedFiles ).toBe( 18500 );
		expect( formatImporterProgressSnapshot( repairedSnapshot, 'Files', 12 ) ).toBe(
			'Files · 18500/78000 files · 12s'
		);
	} );

	it( 'prefers phase text over a generic starting status', () => {
		const snapshot = updateImporterProgressSnapshot( {
			status: 'starting',
			phase: 'fetch',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading essential files', 4 ) ).toBe(
			'Downloading essential files · starting · 4s'
		);
	} );

	it( 'uses the indexing label for symlink-follow progress even after the default starting phase', () => {
		const snapshot = updateImporterProgressSnapshot(
			{
				type: 'symlink_follow',
				directory: '/wordpress/themes/twentytwentyone/2.7',
			},
			{ phase: 'starting' }
		);

		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading files', 60 ) ).toBe(
			'Indexing remote files · following symlink .../themes/twentytwentyone/2.7 · 1m 0s'
		);
	} );

	it( 'does not surface resuming lifecycle events to the user', () => {
		const snapshot = updateImporterProgressSnapshot( {
			type: 'lifecycle',
			event: 'resuming',
			command: 'files-sync',
			stage: 'index',
		} );
		// "resuming" is suppressed — the snapshot keeps whatever message was there before
		expect( snapshot!.message ).toBeUndefined();
	} );

	it( 'formats symlink-follow events as progress details', () => {
		const snapshot = updateImporterProgressSnapshot( {
			type: 'symlink_follow',
			directory: '/wordpress/plugins/jetpack/15.7-a.7',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading essential files', 8 ) ).toBe(
			'Indexing remote files · following symlink .../plugins/jetpack/15.7-a.7 · 8s'
		);
	} );

	it( 'ignores the final response envelope records', () => {
		expect(
			formatImporterJsonlProgress(
				{
					http_code: 200,
					data: { ok: true },
				},
				'Downloading essential files',
				9
			)
		).toBeNull();
	} );

	it( 'rewrites importer VFS arguments to host paths for native PHP execution', () => {
		const args = rewriteImporterArgsForNativePhp(
			'/host/state',
			'/host/docroot',
			'/host/tmp',
			[
				'files-sync',
				'https://example.com/?site-export-api',
				'--state-dir=/state',
				'--fs-root=/docroot',
				'--flatten-to=/flat',
				'--output-dir=/output',
			],
			[
				{ hostPath: '/host/flat', vfsPath: '/flat' },
				{ hostPath: '/host/output', vfsPath: '/output' },
			]
		);

		expect( args ).toContain( 'files-sync' );
		expect( args ).toContain( 'https://example.com/?site-export-api' );
		expect( args ).toContain( '--state-dir=/host/state' );
		expect( args ).toContain( '--fs-root=/host/docroot' );
		expect( args ).toContain( '--flatten-to=/host/flat' );
		expect( args ).toContain( '--output-dir=/host/output' );
	} );

	it( 'tracks exact indexed entries from the base index and update log', () => {
		const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-progress-' ) );
		const indexPath = path.join( tempDir, '.import-index.jsonl' );
		const updatesPath = path.join( tempDir, '.import-index-updates.jsonl' );
		const tracker = new ImporterIndexProgressTracker( tempDir );

		try {
			fs.writeFileSync( indexPath, `${ buildIndexLine( '/a' ) }\n` );
			expect( tracker.getIndexedEntries() ).toBe( 1 );

			fs.writeFileSync(
				updatesPath,
				`${ buildUpdateLine( '/b', 'F' ) }\n${ buildUpdateLine( '/c', 'F' ) }\n`
			);
			expect( tracker.getIndexedEntries() ).toBe( 3 );

			fs.appendFileSync( updatesPath, `${ buildUpdateLine( '/b', 'D' ) }\n` );
			expect( tracker.getIndexedEntries() ).toBe( 2 );
		} finally {
			fs.rmSync( tempDir, { recursive: true, force: true } );
		}
	} );

	it( 'keeps the exact count stable across merged update log rebuilds', () => {
		const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-import-progress-' ) );
		const indexPath = path.join( tempDir, '.import-index.jsonl' );
		const updatesPath = path.join( tempDir, '.import-index-updates.jsonl' );
		const tracker = new ImporterIndexProgressTracker( tempDir );

		try {
			fs.writeFileSync( indexPath, `${ buildIndexLine( '/a' ) }\n` );
			fs.writeFileSync( updatesPath, `${ buildUpdateLine( '/b', 'F' ) }\n` );
			expect( tracker.getIndexedEntries() ).toBe( 2 );

			fs.writeFileSync( indexPath, `${ buildIndexLine( '/a' ) }\n${ buildIndexLine( '/b' ) }\n` );
			fs.rmSync( updatesPath, { force: true } );
			expect( tracker.getIndexedEntries() ).toBe( 2 );

			fs.writeFileSync( updatesPath, `${ buildUpdateLine( '/c', 'F' ) }\n` );
			expect( tracker.getIndexedEntries() ).toBe( 3 );
		} finally {
			fs.rmSync( tempDir, { recursive: true, force: true } );
		}
	} );
} );
