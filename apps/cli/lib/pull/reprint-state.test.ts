import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getReprintStatePath,
	hasLocalFilesIndex,
	readReprintState,
	writeReprintState,
} from 'cli/lib/pull/reprint-state';

describe( 'reprint state accessors', () => {
	it( 'reads a valid reprint state and preserves unknown fields', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			fs.writeFileSync(
				getReprintStatePath( stateDirectory ),
				JSON.stringify( {
					command: 'files-sync',
					status: 'complete',
					stage: null,
					cursor: { path: 'wp-content/uploads/image.jpg' },
					preflight: {
						data: {
							runtime: {
								document_root: '/srv/htdocs',
								extra_runtime_field: true,
							},
							database: {
								wp: {
									paths_urls: {
										content_dir: '/srv/htdocs/wp-content',
									},
								},
							},
						},
					},
					next_reprint_field: 'preserved',
				} )
			);

			expect( readReprintState( stateDirectory ) ).toEqual( {
				command: 'files-sync',
				status: 'complete',
				stage: null,
				cursor: { path: 'wp-content/uploads/image.jpg' },
				preflight: {
					data: {
						runtime: {
							document_root: '/srv/htdocs',
							extra_runtime_field: true,
						},
						database: {
							wp: {
								paths_urls: {
									content_dir: '/srv/htdocs/wp-content',
								},
							},
						},
					},
				},
				next_reprint_field: 'preserved',
			} );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'writes a validated reprint state snapshot', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			writeReprintState( stateDirectory, {
				command: 'files-sync',
				status: 'complete',
				stage: null,
				filter: 'essential-files',
				preflight: { data: { database: { ok: true } } },
			} );

			const raw = fs.readFileSync( getReprintStatePath( stateDirectory ), 'utf-8' );
			expect( raw.endsWith( '\n' ) ).toBe( true );
			expect( JSON.parse( raw ) ).toEqual( {
				command: 'files-sync',
				status: 'complete',
				stage: null,
				filter: 'essential-files',
				preflight: { data: { database: { ok: true } } },
			} );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'reports a local files index only when present and non-empty', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			const localIndexPath = path.join( stateDirectory, '.import-index.jsonl' );
			expect( hasLocalFilesIndex( stateDirectory ) ).toBe( false );

			fs.writeFileSync( localIndexPath, '' );
			expect( hasLocalFilesIndex( stateDirectory ) ).toBe( false );

			fs.writeFileSync( localIndexPath, '{"path":"abc"}\n' );
			expect( hasLocalFilesIndex( stateDirectory ) ).toBe( true );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );
} );
