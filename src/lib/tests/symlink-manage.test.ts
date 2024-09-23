import { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'path';
import { PHP, UnmountFunction } from '@php-wasm/universal';
import { waitFor } from '@testing-library/react';
import { pathExists } from '../fs-utils';
import { SymlinkManager } from '../symlink-manager';

jest.mock( '@php-wasm/universal' );
jest.mock( 'node:fs/promises' );

jest.mock( '../fs-utils' );

// Define a type for the private properties we need to access
type SymlinkManagerPrivateProperties = {
	symlinks: Map< string, string >;
	mountedTargets: Map<
		string,
		{ referenceCount: number; unmountFunction: UnmountFunction | null }
	>;
	watcher: AsyncIterable< fs.FileChangeInfo< string > > | null;
	watcherAbortController: AbortController | null;
};

describe( 'SymlinkManager', () => {
	let symlinkManager: SymlinkManager;
	let mockPHP: jest.Mocked< PHP >;
	const mockProjectPath = '/mock/project/path';

	beforeEach( () => {
		mockPHP = {
			fileExists: jest.fn().mockReturnValue( false ),
			readlink: jest.fn(),
			mkdir: jest.fn(),
			mount: jest.fn(),
			isFile: jest.fn(),
			isDir: jest.fn(),
			unlink: jest.fn(),
			rmdir: jest.fn(),
			requestHandler: {
				documentRoot: '/mock/document/root',
			},
		} as unknown as jest.Mocked< PHP >;

		symlinkManager = new SymlinkManager( mockPHP, mockProjectPath );

		jest.mock( 'path', () => ( {
			...jest.requireActual( 'path' ),
			basename: jest.fn( ( p: string ) => {
				const parts = p.split( /[\\/]/ );
				return parts[ parts.length - 1 ];
			} ),
		} ) );

		// Mock pathExists function
		( pathExists as jest.Mock ).mockImplementation( ( fullPath: string ) => {
			return Promise.resolve( fullPath.includes( 'existing' ) );
		} );
	} );

	afterEach( () => {
		jest.resetAllMocks();
	} );

	describe( 'scanAndCreateSymlinks', () => {
		it( 'should scan for symlinks and create them in the PHP runtime', async () => {
			const mockSymlinks = [
				'/mock/project/path/existing/symlink1',
				'/mock/project/path/existing/symlink2',
			];

			mockPHP.fileExists.mockImplementation( ( path ) => ! path.includes( 'vfspath' ) );
			mockPHP.readlink.mockImplementation( ( path ) => '/mock/document/root/vfspath/' + path );

			// Mock fs.readdir to return our mock symlinks
			( fs.readdir as jest.Mock ).mockResolvedValue(
				mockSymlinks.map( ( s ) => path.basename( s ) )
			);

			// Mock fs.lstat to indicate these are symlinks
			( fs.lstat as jest.Mock ).mockResolvedValue( { isSymbolicLink: () => true } as Stats );

			// Mock fs.realpath to return a target for each symlink
			( fs.realpath as jest.Mock ).mockImplementation( ( p: string ) =>
				Promise.resolve( `/real/path/to/${ path.basename( p ) }` )
			);

			await symlinkManager.scanAndCreateSymlinks();

			// Verify that PHP mkdir and mount were called for each symlink
			expect( mockPHP.mkdir ).toHaveBeenCalledTimes( 2 );
			expect( mockPHP.mount ).toHaveBeenCalledTimes( 2 );

			// Verify that the symlinks were added to the internal map
			expect( ( symlinkManager as unknown as SymlinkManagerPrivateProperties ).symlinks.size ).toBe(
				2
			);

			// Verify that the mount targets were added to the internal map
			expect(
				( symlinkManager as unknown as SymlinkManagerPrivateProperties ).mountedTargets.size
			).toBe( 2 );
		} );

		it( 'should scan for symlinks and not mount duplicate links', async () => {
			const mockSymlinks = [
				'/mock/project/path/existing/symlink1',
				'/mock/project/path/existing/symlink2',
			];

			mockPHP.fileExists.mockImplementation( ( path ) => ! path.includes( 'vfspath' ) );
			mockPHP.readlink.mockImplementation( () => '/mock/document/root/vfspath' );

			// Mock fs.readdir to return our mock symlinks
			( fs.readdir as jest.Mock ).mockResolvedValue(
				mockSymlinks.map( ( s ) => path.basename( s ) )
			);

			// Mock fs.lstat to indicate these are symlinks
			( fs.lstat as jest.Mock ).mockResolvedValue( { isSymbolicLink: () => true } as Stats );

			// Mock fs.realpath to return a target for each symlink
			( fs.realpath as jest.Mock ).mockImplementation( ( p: string ) =>
				Promise.resolve( `/real/path/to/${ path.basename( p ) }` )
			);

			await symlinkManager.scanAndCreateSymlinks();

			// Verify that PHP mkdir and mount were called for each symlink
			expect( mockPHP.mkdir ).toHaveBeenCalledTimes( 1 );
			expect( mockPHP.mount ).toHaveBeenCalledTimes( 1 );

			// Verify that the symlinks were added to the internal map
			expect( ( symlinkManager as unknown as SymlinkManagerPrivateProperties ).symlinks.size ).toBe(
				2
			);

			// Verify that the mount targets were added to the internal map
			expect(
				( symlinkManager as unknown as SymlinkManagerPrivateProperties ).mountedTargets.size
			).toBe( 1 );
		} );
	} );

	describe( 'startWatching and stopWatching', () => {
		it( 'should start and stop watching for file changes', async () => {
			const mockWatcher = {
				[ Symbol.asyncIterator ]: jest.fn().mockImplementation( () => ( {
					next: jest.fn().mockResolvedValue( { done: true, value: undefined } ),
				} ) ),
			};
			jest.spyOn( fs, 'watch' ).mockReturnValue( mockWatcher );

			await symlinkManager.startWatching();
			expect( fs.watch ).toHaveBeenCalledWith( mockProjectPath, expect.any( Object ) );
			await symlinkManager.stopWatching();

			expect( ( symlinkManager as unknown as SymlinkManagerPrivateProperties ).watcher ).toBeNull();
			expect(
				( symlinkManager as unknown as SymlinkManagerPrivateProperties ).watcherAbortController
			).toBeNull();
		} );
	} );

	describe( 'file change handling', () => {
		it( 'should handle symlink creation', async () => {
			mockPHP.fileExists.mockImplementation( ( path ) => ! path.includes( 'vfspath' ) );
			mockPHP.readlink.mockImplementation( ( path ) => '/mock/document/root/vfspath/' + path );
			( pathExists as jest.Mock ).mockResolvedValue( true );
			const mockWatcher = {
				[ Symbol.asyncIterator ]: jest.fn().mockImplementation( () => ( {
					next: jest
						.fn()
						.mockResolvedValueOnce( {
							done: false,
							value: { eventType: 'rename', filename: 'newSymlink' },
						} )
						.mockResolvedValueOnce( { done: true, value: undefined } ),
				} ) ),
			};
			jest.spyOn( fs, 'watch' ).mockReturnValue( mockWatcher );

			( fs.lstat as jest.Mock ).mockResolvedValue( { isSymbolicLink: () => true } as Stats );
			( fs.realpath as jest.Mock ).mockResolvedValue( '/real/path/to/newSymlink' );

			await symlinkManager.startWatching();
			await waitFor( () => {
				expect( mockPHP.mkdir ).toHaveBeenCalled();
				expect( mockPHP.mount ).toHaveBeenCalled();
				const privateProps = symlinkManager as unknown as SymlinkManagerPrivateProperties;
				expect( privateProps.symlinks.has( 'newSymlink' ) ).toBe( true );
			} );
			await symlinkManager.stopWatching();
		} );

		it( 'should handle symlink deletion', async () => {
			const privateProps = symlinkManager as unknown as SymlinkManagerPrivateProperties;
			privateProps.symlinks.set( 'existingSymlink', '/vfs/path/to/target' );
			const unmountFunction = jest.fn();
			privateProps.mountedTargets.set( '/vfs/path/to/target', {
				referenceCount: 1,
				unmountFunction,
			} );

			const mockWatcher = {
				[ Symbol.asyncIterator ]: jest.fn().mockImplementation( () => ( {
					next: jest
						.fn()
						.mockResolvedValueOnce( {
							done: false,
							value: { eventType: 'rename', filename: 'existingSymlink' },
						} )
						.mockResolvedValueOnce( { done: true, value: undefined } ),
				} ) ),
			};
			jest.spyOn( fs, 'watch' ).mockReturnValue( mockWatcher );

			( pathExists as jest.Mock ).mockResolvedValue( false );

			await symlinkManager.startWatching();
			await waitFor( () => {
				expect( privateProps.symlinks.has( 'existingSymlink' ) ).toBe( false );
				expect( unmountFunction ).toHaveBeenCalled();
			} );
			await symlinkManager.stopWatching();
		} );

		it( 'should handle symlink target deletion when no more references exist', async () => {
			const privateProps = symlinkManager as unknown as SymlinkManagerPrivateProperties;
			privateProps.symlinks.set( 'existingSymlink1', '/vfs/path/to/target' );
			privateProps.symlinks.set( 'existingSymlink2', '/vfs/path/to/target' );
			const unmountFunction = jest.fn();
			privateProps.mountedTargets.set( '/vfs/path/to/target', {
				referenceCount: 2,
				unmountFunction,
			} );

			const mockWatcher = {
				[ Symbol.asyncIterator ]: jest.fn().mockImplementation( () => ( {
					next: jest
						.fn()
						.mockResolvedValueOnce( {
							done: false,
							value: { eventType: 'rename', filename: 'existingSymlink1' },
						} )
						.mockResolvedValueOnce( { done: true, value: undefined } ),
				} ) ),
			};
			jest.spyOn( fs, 'watch' ).mockReturnValue( mockWatcher );

			( pathExists as jest.Mock ).mockResolvedValue( false );

			await symlinkManager.startWatching();
			await waitFor( () => {
				expect( privateProps.symlinks.has( 'existingSymlink1' ) ).toBe( false );
				expect( privateProps.symlinks.has( 'existingSymlink2' ) ).toBe( true );
				expect( unmountFunction ).toHaveBeenCalledTimes( 0 );
			} );
			await symlinkManager.stopWatching();
		} );
	} );
} );
