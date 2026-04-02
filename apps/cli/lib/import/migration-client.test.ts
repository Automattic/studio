import { describe, expect, it } from 'vitest';
import {
	formatImporterJsonlProgress,
	formatImporterProgressSnapshot,
	resolveNativeImporterInvocation,
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

	it( 'shows indexing text when the importer reports the index phase', () => {
		expect( formatImporterJsonlProgress( { phase: 'index' }, 'Downloading essential files', 7 ) ).toBe(
			'Downloading essential files · indexing files · 7s'
		);
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
		expect( formatImporterProgressSnapshot( heartbeatSnapshot!, 'Downloading essential files', 4 ) ).toBe(
			'Downloading essential files · 6.0 MB received · 4s'
		);

		const progressSnapshot = updateImporterProgressSnapshot(
			{
				progress_check: true,
				bytes_received: 1024 * 1024 * 8,
				rate_bps: 1024 * 512,
			},
			heartbeatSnapshot!
		);
		expect( formatImporterProgressSnapshot( progressSnapshot!, 'Downloading essential files', 5 ) ).toBe(
			'Downloading essential files · 8.0 MB received · 512 KB/s · 5s'
		);
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

		expect( formatImporterProgressSnapshot( restartedHeartbeat!, 'Downloading essential files', 7 ) ).toBe(
			'Downloading essential files · indexing files · 6.5 MB received · following symlink .../plugins/jetpack/15.7-a.7 · 7s'
		);
	} );

	it( 'prefers phase text over a generic starting status', () => {
		const snapshot = updateImporterProgressSnapshot( {
			status: 'starting',
			phase: 'fetch',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading essential files', 4 ) ).toBe(
			'Downloading essential files · downloading files · 4s'
		);
	} );

	it( 'uses lifecycle records to expose resumable phase information', () => {
		const snapshot = updateImporterProgressSnapshot( {
			type: 'lifecycle',
			event: 'resuming',
			command: 'files-sync',
			stage: 'index',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading essential files', 4 ) ).toBe(
			'Downloading essential files · indexing files · resuming · 4s'
		);
	} );

	it( 'formats symlink-follow events as indexing progress details', () => {
		const snapshot = updateImporterProgressSnapshot( {
			type: 'symlink_follow',
			directory: '/wordpress/plugins/jetpack/15.7-a.7',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Downloading essential files', 8 ) ).toBe(
			'Downloading essential files · indexing files · following symlink .../plugins/jetpack/15.7-a.7 · 8s'
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
		const command = resolveNativeImporterInvocation(
			'/tmp/importer.phar',
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

		expect( command.args ).toContain( '/tmp/importer.phar' );
		expect( command.args ).toContain( '--state-dir=/host/state' );
		expect( command.args ).toContain( '--fs-root=/host/docroot' );
		expect( command.args ).toContain( '--flatten-to=/host/flat' );
		expect( command.args ).toContain( '--output-dir=/host/output' );
	} );
} );
