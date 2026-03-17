import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import { installAiInstructionsToSite } from '../ai-skills';
import { pathExists, recursiveCopyDirectory } from '../fs-utils';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		mkdir: vi.fn(),
		readdir: vi.fn(),
		copyFile: vi.fn(),
		rm: vi.fn(),
		symlink: vi.fn(),
	},
} ) );

vi.mock( '../fs-utils', () => ( {
	pathExists: vi.fn(),
	recursiveCopyDirectory: vi.fn(),
} ) );

const SITE_PATH = '/test/my-site';
const BUNDLED_PATH = '/mock/server-files/skills';

describe( 'installAiInstructionsToSite', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.symlink ).mockResolvedValue( undefined );
		vi.mocked( fs.copyFile ).mockResolvedValue( undefined );
	} );

	it( 'copies loose .md files to site root', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'AGENTS.md' ),
			path.join( SITE_PATH, 'AGENTS.md' )
		);
		expect( fs.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'STUDIO.md' ),
			path.join( SITE_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips .md files that already exist when overwrite is false', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			if ( p === path.join( SITE_PATH, 'AGENTS.md' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, false );

		expect( fs.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'STUDIO.md' ),
			path.join( SITE_PATH, 'STUDIO.md' )
		);
	} );

	it( 'installs directories as skills with symlinks', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'studio-cli' ),
			path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
		);
		expect( fs.symlink ).toHaveBeenCalledWith(
			path.relative(
				path.join( SITE_PATH, '.claude', 'skills' ),
				path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
			),
			path.join( SITE_PATH, '.claude', 'skills', 'studio-cli' )
		);
	} );

	it( 'removes existing skills when overwrite is true', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			// SKILL.md exists, symlink exists
			return true;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'wp-rest-api', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, true );

		expect( fs.rm ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api' ),
			{ recursive: true, force: true }
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips when bundled path does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.symlink ).not.toHaveBeenCalled();
		expect( fs.copyFile ).not.toHaveBeenCalled();
	} );

	it( 'handles both .md files and skill directories in one pass', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 1 );
		expect( fs.symlink ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores non-.md files at the root level', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'index.ts', isFile: () => true, isDirectory: () => false },
			{ name: 'raw-imports.d.ts', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'AGENTS.md' ),
			path.join( SITE_PATH, 'AGENTS.md' )
		);
	} );

	it( 'installs multiple skills with correct paths and symlinks', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-block-development', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		// 2 .md files copied to site root
		expect( fs.copyFile ).toHaveBeenCalledTimes( 2 );

		// 3 skill directories copied to .agents/skills/
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 3 );
		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'studio-cli' ),
			path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'wp-plugin-development' ),
			path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' )
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'wp-block-development' ),
			path.join( SITE_PATH, '.agents', 'skills', 'wp-block-development' )
		);

		// 3 symlinks created in .claude/skills/
		expect( fs.symlink ).toHaveBeenCalledTimes( 3 );
		expect( fs.mkdir ).toHaveBeenCalledWith( path.join( SITE_PATH, '.claude', 'skills' ), {
			recursive: true,
		} );
	} );

	it( 'continues installing remaining skills when one fails', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'broken-skill', isFile: () => false, isDirectory: () => true },
			{ name: 'good-skill', isFile: () => false, isDirectory: () => true },
		] as never );
		vi.mocked( recursiveCopyDirectory )
			.mockRejectedValueOnce( new Error( 'copy failed' ) )
			.mockResolvedValueOnce( undefined );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		// Both skills attempted, second one succeeds
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 2 );
		expect( fs.symlink ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'falls back to junction on Windows EPERM', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.readdir ).mockResolvedValue( [
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
		] as never );

		const epermError = Object.assign( new Error( 'EPERM' ), { code: 'EPERM' } );
		vi.mocked( fs.symlink ).mockRejectedValueOnce( epermError ).mockResolvedValue( undefined );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, false );

		expect( fs.symlink ).toHaveBeenCalledWith(
			path.resolve( path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' ) ),
			path.join( SITE_PATH, '.claude', 'skills', 'wp-plugin-development' ),
			'junction'
		);

		Object.defineProperty( process, 'platform', { value: originalPlatform } );
	} );
} );
