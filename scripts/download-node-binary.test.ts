import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNodeBinary, resolveNodeTarget } from './download-node-binary';

const tempRoots: string[] = [];

function makeTempRoot(): string {
	const tempRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-node-binary-test-' ) );
	tempRoots.push( tempRoot );
	return tempRoot;
}

afterEach( () => {
	for ( const tempRoot of tempRoots.splice( 0 ) ) {
		fs.rmSync( tempRoot, { recursive: true, force: true } );
	}
	vi.restoreAllMocks();
} );

describe( 'installNodeBinary', () => {
	it( 'copies the current Node binary without downloading when the target matches the runtime', async () => {
		const tempRoot = makeTempRoot();
		const sourceNode = path.join( tempRoot, 'current-node' );
		fs.writeFileSync( sourceNode, 'current node binary' );

		const result = await installNodeBinary( {
			platform: 'linux',
			arch: 'x64',
			nodeVersion: 'v24.15.0',
			binDir: path.join( tempRoot, 'bin' ),
			cacheDir: path.join( tempRoot, 'cache' ),
			currentPlatform: 'linux',
			currentArch: 'x64',
			currentNodeVersion: 'v24.15.0',
			currentNodePath: sourceNode,
			downloadArchive: vi.fn( async () => {
				throw new Error( 'download should not run' );
			} ),
			extractTarGz: vi.fn( async () => {
				throw new Error( 'extract should not run' );
			} ),
		} );

		expect( result.source ).toBe( 'current' );
		expect( fs.readFileSync( result.destPath, 'utf8' ) ).toBe( 'current node binary' );
		expect( fs.existsSync( path.join( tempRoot, 'cache' ) ) ).toBe( false );
	} );

	it( 'uses a cached archive without downloading when the target does not match the runtime', async () => {
		const tempRoot = makeTempRoot();
		const cacheDir = path.join( tempRoot, 'cache' );
		const archivePath = path.join( cacheDir, 'node-v24.15.0-linux-x64.tar.gz' );
		fs.mkdirSync( cacheDir, { recursive: true } );
		fs.writeFileSync( archivePath, 'cached archive' );

		const downloadArchive = vi.fn( async () => {
			throw new Error( 'download should not run' );
		} );
		const extractTarGz = vi.fn(
			async (
				archive: string,
				destDir: string,
				binaryName: string,
				_nodeVersion: string,
				_target: ReturnType< typeof resolveNodeTarget >,
				_tmpDir: string
			) => {
				expect( archive ).toBe( archivePath );
				fs.writeFileSync( path.join( destDir, binaryName ), 'extracted cached node' );
			}
		);

		const result = await installNodeBinary( {
			platform: 'linux',
			arch: 'x64',
			nodeVersion: 'v24.15.0',
			binDir: path.join( tempRoot, 'bin' ),
			tmpDir: path.join( tempRoot, 'tmp' ),
			cacheDir,
			currentPlatform: 'darwin',
			currentArch: 'arm64',
			currentNodeVersion: 'v24.15.0',
			downloadArchive,
			extractTarGz,
		} );

		expect( result.source ).toBe( 'cache' );
		expect( downloadArchive ).not.toHaveBeenCalled();
		expect( extractTarGz ).toHaveBeenCalledOnce();
		expect( fs.readFileSync( result.destPath, 'utf8' ) ).toBe( 'extracted cached node' );
	} );

	it( 'downloads once, stores the archive in cache, then extracts from cache', async () => {
		const tempRoot = makeTempRoot();
		const cacheDir = path.join( tempRoot, 'cache' );
		const expectedArchivePath = path.join( cacheDir, 'node-v24.15.0-linux-x64.tar.gz' );
		const downloadArchive = vi.fn( async ( downloadUrl: string, dest: string ) => {
			expect( downloadUrl ).toBe(
				'https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz'
			);
			fs.writeFileSync( dest, 'downloaded archive' );
		} );
		const extractTarGz = vi.fn(
			async (
				archive: string,
				destDir: string,
				binaryName: string,
				_nodeVersion: string,
				_target: ReturnType< typeof resolveNodeTarget >,
				_tmpDir: string
			) => {
				expect( archive ).toBe( expectedArchivePath );
				expect( fs.readFileSync( archive, 'utf8' ) ).toBe( 'downloaded archive' );
				fs.writeFileSync( path.join( destDir, binaryName ), 'extracted downloaded node' );
			}
		);

		const result = await installNodeBinary( {
			platform: 'linux',
			arch: 'x64',
			nodeVersion: 'v24.15.0',
			binDir: path.join( tempRoot, 'bin' ),
			tmpDir: path.join( tempRoot, 'tmp' ),
			cacheDir,
			currentPlatform: 'darwin',
			currentArch: 'arm64',
			currentNodeVersion: 'v24.15.0',
			downloadArchive,
			extractTarGz,
		} );

		expect( result.source ).toBe( 'download' );
		expect( downloadArchive ).toHaveBeenCalledOnce();
		expect( extractTarGz ).toHaveBeenCalledOnce();
		expect( fs.readFileSync( expectedArchivePath, 'utf8' ) ).toBe( 'downloaded archive' );
		expect( fs.readFileSync( result.destPath, 'utf8' ) ).toBe( 'extracted downloaded node' );
	} );
} );
