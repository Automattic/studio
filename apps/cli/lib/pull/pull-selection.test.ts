import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applySelection,
	isFullPull,
	parsePullSyncOptions,
	pullSelectionFromSyncOptions,
} from 'cli/lib/pull/pull-selection';
import { emptyReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import { fetchJetpackPullTree, selectPullItems } from 'cli/lib/pull/reprint-selector';
import type { SyncOption } from '@studio/common/types/sync';

vi.mock( 'cli/lib/pull/reprint-selector', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/pull/reprint-selector') >() ),
	fetchJetpackPullTree: vi.fn(),
	selectPullItems: vi.fn(),
} ) );

describe( 'pullSelectionFromSyncOptions', () => {
	// The app's presets and file picks, as `studio pull --options` receives them.
	it.each< [ string, SyncOption[], string[] | undefined, object ] >( [
		[ 'everything', [ 'all' ], undefined, {} ],
		[ 'the database', [ 'sqls' ], undefined, { skipFiles: true } ],
		[
			'all files',
			[ 'plugins', 'themes', 'uploads', 'contents' ],
			undefined,
			{ skipDatabase: true },
		],
		[
			'some folders',
			[ 'themes', 'sqls' ],
			undefined,
			{ only: [ 'themes' ], skipDatabase: false },
		],
		[ 'the uploads', [ 'uploads' ], undefined, { only: [ ':wp-uploads:' ], skipDatabase: true } ],
		[
			'picked files',
			[ 'paths' ],
			[ 'plugins/akismet' ],
			{ only: [ 'plugins/akismet' ], skipDatabase: true },
		],
		[ 'only the database, picked', [ 'sqls' ], [], { skipFiles: true } ],
	] )( 'pulls %s', ( _, options, only, expected ) => {
		expect( pullSelectionFromSyncOptions( parsePullSyncOptions( options, only ) ) ).toEqual(
			expected
		);
	} );

	it( 'rejects the paths option without paths', () => {
		expect( () => parsePullSyncOptions( [ 'paths', 'sqls' ] ) ).toThrow( '--only' );
	} );
} );

describe( 'applySelection with --skip-files', () => {
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-selection-' ) );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it.each( [
		[ 'first', true, { databaseOnly: true } ],
		[ 'later', false, { skipFiles: true } ],
	] )( 'pulls only the database on a %s pull', async ( _, isFirstPull, expected ) => {
		const selection = await applySelection( {
			session: { stateDirectory: path.join( root, 'state' ) } as never,
			isFirstPull,
			reprintMetadata: emptyReprintMetadata,
			cli: { skipFiles: true },
			wpComAccessToken: 'token',
			wpComSiteId: 1,
		} );

		expect( selection ).toEqual( expected );
	} );
} );

describe( 'isFullPull', () => {
	it.each( [
		[ 'everything', {}, true ],
		[ 'without the database', { skipDatabase: true }, false ],
		[ 'only the database, after a first pull', { skipFiles: true }, false ],
		[ 'only the database, on a first pull', { databaseOnly: true }, false ],
		[ 'some paths', { fileOnlyPaths: [ ':wp-content:/plugins' ] }, false ],
	] )( 'is %s', ( _, selection, expected ) => {
		expect( isFullPull( selection ) ).toBe( expected );
	} );
} );

describe( 'applySelection with the picker', () => {
	const stdinIsTTY = process.stdin.isTTY;
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-selection-' ) );
		process.stdin.isTTY = true;
		vi.mocked( fetchJetpackPullTree ).mockResolvedValue( [
			{ name: 'Database', value: 'database' },
		] as never );
	} );

	afterEach( () => {
		process.stdin.isTTY = stdinIsTTY;
		fs.rmSync( root, { recursive: true, force: true } );
		vi.resetAllMocks();
	} );

	const pick = ( picked: Awaited< ReturnType< typeof selectPullItems > > ) => {
		vi.mocked( selectPullItems ).mockResolvedValue( picked );
		return applySelection( {
			session: {
				sitePath: path.join( root, 'site' ),
				stateDirectory: path.join( root, 'state' ),
				rawDirectory: path.join( root, 'raw' ),
			} as never,
			isFirstPull: true,
			reprintMetadata: {
				...emptyReprintMetadata,
				sourceSite: {
					...emptyReprintMetadata.sourceSite,
					contentDirectory: '/srv/htdocs/wp-content',
				},
			},
			cli: {},
			wpComAccessToken: 'token',
			wpComSiteId: 1,
		} );
	};

	it( 'records a database-only first pull', async () => {
		const selection = await pick( { fileOnlyPaths: [], skipDatabase: false, hasAnyFile: false } );

		expect( selection ).toEqual( { skipDatabase: false, databaseOnly: true } );
	} );

	it( 'records the picked paths without WordPress core', async () => {
		const selection = await pick( {
			fileOnlyPaths: [ ':wp-content:/plugins' ],
			skipDatabase: false,
			hasAnyFile: true,
		} );

		expect( selection ).toEqual( {
			skipDatabase: false,
			fileOnlyPaths: [ ':wp-content:/plugins' ],
		} );
	} );
} );
