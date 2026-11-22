import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applySelection,
	isFullPull,
	pullSelectionFromSyncOptions,
} from 'cli/lib/pull/pull-selection';
import { emptyReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import {
	buildCategoryPullTree,
	fetchJetpackPullTree,
	mapCheckedNodesToSelection,
	selectPullItems,
} from 'cli/lib/pull/reprint-selector';
import { LoggerError } from 'cli/logger';
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
		[
			'picked files',
			[ 'paths' ],
			[ 'plugins/akismet' ],
			{ only: [ 'plugins/akismet' ], skipDatabase: true },
		],
		[ 'only the database, picked', [ 'sqls' ], [], { skipFiles: true } ],
	] )( 'pulls %s', ( _, options, only, expected ) => {
		expect( pullSelectionFromSyncOptions( options, only ) ).toEqual( expected );
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

	const pick = (
		picked: Awaited< ReturnType< typeof selectPullItems > >,
		filesUnavailable = false
	) => {
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
			filesUnavailable,
		} );
	};

	it( 'offers fixed categories when the remote has no backup', async () => {
		vi.mocked( fetchJetpackPullTree ).mockRejectedValue(
			new LoggerError( 'Failed to fetch latest rewind ID', undefined, 'missing_backup' )
		);
		const tree = buildCategoryPullTree();
		const plugins = tree[ 1 ].children![ 0 ];
		const selection = await pick( mapCheckedNodesToSelection( [ tree[ 0 ], plugins ] ) );
		expect( selectPullItems ).toHaveBeenCalledWith( tree, {
			allowDatabaseOnly: true,
			token: undefined,
			remoteSiteId: undefined,
		} );
		expect( tree[ 1 ].children?.map( ( node ) => node.value ) ).toEqual( [
			'plugins',
			'themes',
			'uploads',
		] );
		expect( selection ).toEqual( {
			skipDatabase: false,
			fileOnlyPaths: [ ':wp-content:/plugins' ],
		} );
	} );

	it( 'skips the backup lookup when the remote needs an upgrade', async () => {
		await pick( { fileOnlyPaths: [], skipDatabase: false, hasAnyFile: true }, true );
		expect( fetchJetpackPullTree ).not.toHaveBeenCalled();
		expect( selectPullItems ).toHaveBeenCalledWith( buildCategoryPullTree(), {
			allowDatabaseOnly: true,
			token: undefined,
			remoteSiteId: undefined,
		} );
	} );

	it( 'surfaces other backup lookup failures', async () => {
		vi.mocked( fetchJetpackPullTree ).mockRejectedValue( new Error( 'Network failure' ) );
		await expect( pick( undefined ) ).rejects.toThrow( 'Network failure' );
		expect( selectPullItems ).not.toHaveBeenCalled();
	} );

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
