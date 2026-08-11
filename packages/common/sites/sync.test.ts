import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { pullSite } from './sync';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

describe( 'pullSite', () => {
	it( 'runs the Jetpack-backup `pull` command by default', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42 );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull', '--path', '/sites/local', '--remote-site', '42', '--options', 'all' ],
			{ output: 'capture' }
		);
	} );

	it( 'runs `pull-reprint` with the same --remote-site identifier for the reprint engine', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42, { engine: 'reprint' } );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull-reprint', '--path', '/sites/local', '--remote-site', '42' ],
			{ output: 'capture' }
		);
	} );

	// Selective sync selects by backup node id, which reprint has no equivalent
	// for — so the reprint engine pulls everything and drops the selection.
	it( 'ignores selective-sync options for the reprint engine', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42, {
			engine: 'reprint',
			syncOptions: { optionsToSync: [ 'paths' ], includePathList: [ 'ZjE6Lw==' ] },
		} );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull-reprint', '--path', '/sites/local', '--remote-site', '42' ],
			{ output: 'capture' }
		);
	} );

	it( 'forwards live CLI messages and their percentage', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
		const onProgress = vi.fn();
		const pulling = pullSite( execute, '/sites/local', 42, { emit: onProgress } );

		emitter.emit( 'data', {
			data: {
				action: 'initiateBackup',
				status: 'inprogress',
				message: 'Creating remote backup… (24%)',
			},
		} );
		emitter.emit( 'data', {
			data: {
				action: 'importWpContent',
				status: 'inprogress',
				message: 'Importing media uploads… (3/10)',
			},
		} );
		emitter.emit( 'success' );

		await pulling;
		expect( onProgress ).toHaveBeenNthCalledWith( 1, {
			message: 'Creating remote backup… (24%)',
			progress: 24,
		} );
		expect( onProgress ).toHaveBeenNthCalledWith( 2, {
			message: 'Importing media uploads… (3/10)',
		} );
	} );

	it( 'passes backup node ids with commas as separate argv values', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
		const includePathList = [ 'cjE6,ZjE6Lw==', 'cjI6,ZjI6Lw==', 'ZjM6Lw==' ];
		const pulling = pullSite( execute, '/sites/local', 42, {
			syncOptions: { optionsToSync: [ 'paths' ], includePathList },
		} );

		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[
				'pull',
				'--path',
				'/sites/local',
				'--remote-site',
				'42',
				'--options',
				'paths',
				'--include-path-list',
				...includePathList,
			],
			{ output: 'capture' }
		);
	} );
} );
