import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getRemoteIndexPath,
	getReprintStatePath,
	markSkippedFilesPending,
	resetEssentialFilesState,
	setSqliteRuntimeTarget,
} from 'cli/lib/pull/reprint-state';

describe( 'reprint state mutations', () => {
	it( 'records the sqlite runtime target when the database pull is skipped', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );
		const statePath = getReprintStatePath( stateDirectory );

		try {
			fs.mkdirSync( path.dirname( statePath ), { recursive: true } );
			fs.writeFileSync(
				statePath,
				JSON.stringify( { filter: 'essential-files', apply: { target_db: null } } )
			);

			setSqliteRuntimeTarget( stateDirectory, '/pulls/raw/wp-content/database/.ht.sqlite' );

			const state = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) );
			expect( state.apply.target_engine ).toBe( 'sqlite' );
			expect( state.apply.target_sqlite_path ).toBe( '/pulls/raw/wp-content/database/.ht.sqlite' );
			expect( state.apply.target_db ).toBeNull();
			expect( state.filter ).toBe( 'essential-files' );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'marks skipped files pending without replacing the pull pipeline', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );
		const statePath = getReprintStatePath( stateDirectory );

		try {
			fs.mkdirSync( path.dirname( statePath ), { recursive: true } );
			fs.writeFileSync(
				statePath,
				JSON.stringify( { pull_pipeline: { last_completed_stage: 'database' } } )
			);

			markSkippedFilesPending( stateDirectory );

			const state = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) );
			expect( state.pull_pipeline ).toEqual( {
				last_completed_stage: 'database',
				skipped_pending: true,
			} );
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'resets pull artifacts while preserving preflight', () => {
		const stateDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-state-' ) );
		const statePath = getReprintStatePath( stateDirectory );
		const artifactPaths = [
			path.join( stateDirectory, 'pull', 'local-index.jsonl' ),
			getRemoteIndexPath( stateDirectory ),
			path.join( stateDirectory, 'pull', 'fetch-list.jsonl' ),
			path.join( stateDirectory, 'pull', 'skipped-fetch-list.jsonl' ),
			path.join( stateDirectory, 'progress.json' ),
		];

		try {
			fs.mkdirSync( path.dirname( statePath ), { recursive: true } );
			fs.writeFileSync(
				statePath,
				JSON.stringify( {
					preflight: { data: { ok: true } },
					pull_pipeline: { last_completed_stage: 'files' },
				} )
			);
			for ( const artifactPath of artifactPaths ) {
				fs.writeFileSync( artifactPath, 'scratch' );
			}

			resetEssentialFilesState( stateDirectory );

			expect( JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) ).toEqual( {
				preflight: { data: { ok: true } },
			} );
			for ( const artifactPath of artifactPaths ) {
				expect( fs.existsSync( artifactPath ) ).toBe( false );
			}
		} finally {
			fs.rmSync( stateDirectory, { recursive: true, force: true } );
		}
	} );
} );
