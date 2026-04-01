import { describe, expect, it } from 'vitest';
import {
	formatImporterJsonlProgress,
	formatImporterProgressSnapshot,
	updateImporterProgressSnapshot,
} from './migration-client';

describe( 'formatImporterJsonlProgress', () => {
	it( 'shows streamed debug messages from the importer', () => {
		expect(
			formatImporterJsonlProgress(
				{ debug: 'Waiting for server response...' },
				'Essential files',
				3
			)
		).toBe( 'Essential files · Waiting for server response... · 3s' );
	} );

	it( 'shows indexing text when the importer reports the index phase', () => {
		expect( formatImporterJsonlProgress( { phase: 'index' }, 'Essential files', 7 ) ).toBe(
			'Essential files · indexing files · 7s'
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
				'Essential files',
				12
			)
		).toBe( 'Essential files · 42/100 files · 12.5 MB/50.0 MB · 12s' );
	} );

	it( 'falls back to a generic progress message when only a message field is available', () => {
		expect(
			formatImporterJsonlProgress(
				{
					message: 'Downloading file batches',
				},
				'Essential files',
				9
			)
		).toBe( 'Essential files · Downloading file batches · 9s' );
	} );

	it( 'formats heartbeat and progress-check records as byte/rate progress', () => {
		const heartbeatSnapshot = updateImporterProgressSnapshot( {
			heartbeat: true,
			bytes_received: 1024 * 1024 * 6,
		} );
		expect( formatImporterProgressSnapshot( heartbeatSnapshot!, 'Essential files', 4 ) ).toBe(
			'Essential files · 6.0 MB received · 4s'
		);

		const progressSnapshot = updateImporterProgressSnapshot(
			{
				progress_check: true,
				bytes_received: 1024 * 1024 * 8,
				rate_bps: 1024 * 512,
			},
			heartbeatSnapshot!
		);
		expect( formatImporterProgressSnapshot( progressSnapshot!, 'Essential files', 5 ) ).toBe(
			'Essential files · 8.0 MB received · 512 KB/s · 5s'
		);
	} );

	it( 'prefers phase text over a generic starting status', () => {
		const snapshot = updateImporterProgressSnapshot( {
			status: 'starting',
			phase: 'fetch',
		} );
		expect( formatImporterProgressSnapshot( snapshot!, 'Essential files', 4 ) ).toBe(
			'Essential files · downloading files · 4s'
		);
	} );

	it( 'ignores the final response envelope records', () => {
		expect(
			formatImporterJsonlProgress(
				{
					http_code: 200,
					data: { ok: true },
				},
				'Essential files',
				9
			)
		).toBeNull();
	} );
} );
