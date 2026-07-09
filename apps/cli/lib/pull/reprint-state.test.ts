import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getContentDirFromState,
	getCoreRootsFromState,
	hasLocalFilesIndex,
	hasSkippedFiles,
	setSqliteRuntimeTarget,
} from 'cli/lib/pull/reprint-state';

describe( 'reprint state accessors', () => {
	it( 'reads the remote wp-content path from preflight state', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					preflight: {
						data: {
							database: {
								wp: {
									paths_urls: {
										content_dir: '/srv/htdocs/wp-content',
									},
								},
							},
						},
					},
				} )
			);

			expect( getContentDirFromState( stateDirectory ) ).toBe( '/srv/htdocs/wp-content' );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'reads the WordPress core roots from preflight state, decoding base64-marked paths', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			expect( getCoreRootsFromState( stateDirectory ) ).toEqual( [] );

			// reprint persists wp_detect root paths base64-encoded with a
			// `base64:` marker; plain strings are the legacy fallback.
			const encode = ( value: string ) =>
				`base64:${ Buffer.from( value, 'utf-8' ).toString( 'base64' ) }`;
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( {
					preflight: {
						data: {
							wp_detect: {
								roots: [
									{ path: encode( '/wordpress/core/7.0' ) },
									{ path: '/wordpress/core' },
									{ path: null },
								],
							},
						},
					},
				} )
			);

			// The parent root is an ancestor of the live install and would
			// pull every other core version alongside it — dropped.
			expect( getCoreRootsFromState( stateDirectory ) ).toEqual( [ '/wordpress/core/7.0' ] );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'records the sqlite runtime target when the database pull is skipped', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );

		try {
			fs.writeFileSync(
				path.join( stateDirectory, '.import-state.json' ),
				JSON.stringify( { filter: 'essential-files', apply: { target_db: null } } )
			);

			setSqliteRuntimeTarget( stateDirectory, '/pulls/raw/wp-content/database/.ht.sqlite' );

			const state = JSON.parse(
				fs.readFileSync( path.join( stateDirectory, '.import-state.json' ), 'utf-8' )
			);
			expect( state.apply.target_engine ).toBe( 'sqlite' );
			expect( state.apply.target_sqlite_path ).toBe( '/pulls/raw/wp-content/database/.ht.sqlite' );
			expect( state.apply.target_db ).toBeNull();
			expect( state.filter ).toBe( 'essential-files' );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'detects whether reprint left skipped files to download', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );
		const skippedListPath = path.join( stateDirectory, '.import-download-list-skipped.jsonl' );

		try {
			expect( hasSkippedFiles( stateDirectory ) ).toBe( false );

			fs.writeFileSync( skippedListPath, '' );
			expect( hasSkippedFiles( stateDirectory ) ).toBe( false );

			fs.writeFileSync( skippedListPath, '{"path":"wp-content/cache/file"}\n' );
			expect( hasSkippedFiles( stateDirectory ) ).toBe( true );
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
