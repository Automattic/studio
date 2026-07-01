import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import {
	installAiInstructionsToSite,
	installSkillToSite,
	updateManagedInstructionFiles,
} from '../agent-skills';
import { pathExists, recursiveCopyDirectory } from '../fs-utils';

vi.mock( 'fs' );

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
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
	} );

	it( 'copies loose .md files to site root', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'AGENTS.md' ),
			path.join( SITE_PATH, 'AGENTS.md' )
		);
		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
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
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, [], false );

		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'STUDIO.md' ),
			path.join( SITE_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips skill directories not in the user-selected list', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH || p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'skips skill directories even with overwrite when not in user-selected list', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return true;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'wp-rest-api', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, [], true );

		expect( fs.promises.rm ).not.toHaveBeenCalled();
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
	} );

	it( 'skips when bundled path does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
		expect( fs.promises.copyFile ).not.toHaveBeenCalled();
	} );

	it( 'copies .md files but skips unselected skill directories', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH || p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'ignores non-.md files at the root level', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'index.ts', isFile: () => true, isDirectory: () => false },
			{ name: 'raw-imports.d.ts', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'AGENTS.md' ),
			path.join( SITE_PATH, 'AGENTS.md' )
		);
	} );

	it( 'copies only .md files when skill directories are not user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-block-development', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		// 2 .md files copied to site root
		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 2 );

		// No skill directories installed
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'does not attempt to install any skills when none are user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'broken-skill', isFile: () => false, isDirectory: () => true },
			{ name: 'good-skill', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'skips skill directories on any platform when not user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite( SITE_PATH, BUNDLED_PATH, [], false );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );
} );

describe( 'installSkillToSite', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
	} );

	it( 'installs a skill directory with symlink', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );

		await installSkillToSite( SITE_PATH, BUNDLED_PATH, 'studio-cli', false );

		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'studio-cli' ),
			path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
		);
		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			path.relative(
				path.join( SITE_PATH, '.claude', 'skills' ),
				path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
			),
			path.join( SITE_PATH, '.claude', 'skills', 'studio-cli' )
		);
	} );

	it( 'removes existing skill when overwrite is true', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'wp-rest-api' ) ) {
				return true;
			}
			// SKILL.md exists
			if ( p === path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api', 'SKILL.md' ) ) {
				return true;
			}
			return false;
		} );

		await installSkillToSite( SITE_PATH, BUNDLED_PATH, 'wp-rest-api', true );

		expect( fs.promises.rm ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api' ),
			{ recursive: true, force: true }
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'falls back to junction on Windows EPERM', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'wp-plugin-development' ) ) {
				return true;
			}
			return false;
		} );

		const epermError = Object.assign( new Error( 'EPERM' ), { code: 'EPERM' } );
		vi.mocked( fs.promises.symlink )
			.mockRejectedValueOnce( epermError )
			.mockResolvedValue( undefined );

		await installSkillToSite( SITE_PATH, BUNDLED_PATH, 'wp-plugin-development', false );

		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			path.resolve( path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' ) ),
			path.join( SITE_PATH, '.claude', 'skills', 'wp-plugin-development' ),
			'junction'
		);

		Object.defineProperty( process, 'platform', { value: originalPlatform } );
	} );
} );

describe( 'updateManagedInstructionFiles', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
	} );

	it( 'updates STUDIO.md when it exists in the site', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		await updateManagedInstructionFiles( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'STUDIO.md' ),
			path.join( SITE_PATH, 'STUDIO.md' )
		);
		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips files that do not exist in the site', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			// Only STUDIO.md exists in both site and bundled
			if ( p === path.join( SITE_PATH, 'STUDIO.md' ) ) {
				return true;
			}
			if ( p === path.join( BUNDLED_PATH, 'STUDIO.md' ) ) {
				return true;
			}
			return false;
		} );

		await updateManagedInstructionFiles( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.copyFile ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'STUDIO.md' ),
			path.join( SITE_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips files that do not exist in the bundled path', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			// CLAUDE.md exists in site but not in bundled
			if ( p === path.join( SITE_PATH, 'CLAUDE.md' ) ) {
				return true;
			}
			if ( p === path.join( BUNDLED_PATH, 'CLAUDE.md' ) ) {
				return false;
			}
			return false;
		} );

		await updateManagedInstructionFiles( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).not.toHaveBeenCalled();
	} );

	it( 'does nothing when no managed files exist in the site', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await updateManagedInstructionFiles( SITE_PATH, BUNDLED_PATH );

		expect( fs.promises.copyFile ).not.toHaveBeenCalled();
	} );
} );
