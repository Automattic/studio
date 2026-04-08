import { describe, expect, it } from 'vitest';
import {
	formatImporterJsonlProgress,
	formatImporterProgressSnapshot,
	rewriteImporterArgsForNativePhp,
	updateImporterProgressSnapshot,
} from './migration-client';

describe( 'formatImporterJsonlProgress', () => {
	it( 'shows streamed debug messages from the importer', () => {
		expect(
			formatImporterJsonlProgress(
				{ debug: 'Waiting for server response...' },
				'Downloading essential files',
				3
			)
		).toBe( 'Downloading essential files · Waiting for server response... · 3s' );
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

	it( 'formats heartbeat and progress-check records as byte/rate progress', () => {
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
		).toBe( 'Downloading essential files · 8.0 MB received · 512 KB/s · 5s' );
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
			'Downloading essential files · 6.5 MB received · following symlink .../plugins/jetpack/15.7-a.7 · 7s'
		);
	} );

	it( 'uses raw file and byte counts without accumulating across restarts', () => {
		const first = updateImporterProgressSnapshot( {
			downloaded_files: 42,
			total_files: 100,
			downloaded_bytes: 1024 * 1024 * 12,
			total_bytes: 1024 * 1024 * 50,
		} );
		// Importer restarts — counters reset. The raw value is used as-is
		// because the importer re-scans already-handled files on resume and
		// accumulating would over-count.
		const afterRestart = updateImporterProgressSnapshot(
			{
				downloaded_files: 5,
				downloaded_bytes: 1024 * 1024 * 2,
			},
			first!
		);

		expect( afterRestart!.downloadedFiles ).toBe( 5 );
		expect( afterRestart!.downloadedBytes ).toBe( 1024 * 1024 * 2 );
		// totalFiles locked to the first value
		expect( afterRestart!.totalFiles ).toBe( 100 );
		expect( formatImporterProgressSnapshot( afterRestart!, 'Essential files', 20 ) ).toBe(
			'Essential files · 5/100 files · 2.0 MB/50.0 MB · 20s'
		);
	} );

	it( 'locks totalFiles to the first value reported', () => {
		const first = updateImporterProgressSnapshot( {
			total_files: 200,
		} );
		const higher = updateImporterProgressSnapshot( { total_files: 300 }, first! );
		expect( higher!.totalFiles ).toBe( 200 );

		const lower = updateImporterProgressSnapshot( { total_files: 150 }, first! );
		expect( lower!.totalFiles ).toBe( 200 );
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
			'Downloading essential files · following symlink .../plugins/jetpack/15.7-a.7 · 8s'
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
} );
