import { describe, expect, it } from 'vitest';
import { formatImporterProgress } from './migration-client';

describe( 'formatImporterProgress', () => {
	it( 'shows indexing text for filtered file sync while the importer is indexing', () => {
		expect(
			formatImporterProgress( {
				downloaded: { files: 0, bytes: 0 },
				elapsedSeconds: 7,
				importerStatus: { phase: 'index' },
				isFilesSync: true,
				isFilteredFilesSync: true,
				progressLabel: 'Essential files',
				remoteIndex: null,
				stallTicks: 0,
				totalBytes: 0,
			} )
		).toBe( 'Essential files · indexing remote files · 7s' );
	} );

	it( 'shows downloaded bytes only for filtered file sync after indexing', () => {
		expect(
			formatImporterProgress( {
				downloaded: { files: 42, bytes: 1024 * 1024 * 12.5 },
				elapsedSeconds: 12,
				importerStatus: { phase: 'download' },
				isFilesSync: true,
				isFilteredFilesSync: true,
				progressLabel: 'Essential files',
				remoteIndex: null,
				stallTicks: 0,
				totalBytes: 1024 * 1024 * 99,
			} )
		).toBe( 'Essential files · 12.5 MB downloaded · 12s' );
	} );

	it( 'keeps total file counts for unfiltered file sync when a remote index is available', () => {
		expect(
			formatImporterProgress( {
				downloaded: { files: 20, bytes: 1024 * 1024 * 5 },
				elapsedSeconds: 9,
				importerStatus: { phase: 'download' },
				isFilesSync: true,
				isFilteredFilesSync: false,
				progressLabel: 'Files',
				remoteIndex: { files: 100, bytes: 1024 * 1024 * 25 },
				stallTicks: 0,
				totalBytes: 1024 * 1024 * 5,
			} )
		).toBe( 'Files · 20/100 files · 5.0 MB/25.0 MB · 9s' );
	} );
} );
