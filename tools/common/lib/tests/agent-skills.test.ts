import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import { BUNDLED_SKILL_IDS, installSkillsToSite } from '../agent-skills';
import { pathExists, recursiveCopyDirectory } from '../fs-utils';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		mkdir: vi.fn(),
		readdir: vi.fn(),
		copyFile: vi.fn(),
		rm: vi.fn(),
		lstat: vi.fn(),
		symlink: vi.fn(),
		stat: vi.fn(),
	},
} ) );

vi.mock( '../fs-utils', () => ( {
	pathExists: vi.fn(),
	recursiveCopyDirectory: vi.fn(),
} ) );

const SITE_PATH = '/test/my-site';
const BUNDLED_PATH = '/mock/server-files/agent-skills';

describe( 'BUNDLED_SKILL_IDS', () => {
	it( 'contains exactly 5 skills', () => {
		expect( BUNDLED_SKILL_IDS ).toHaveLength( 5 );
	} );

	it( 'includes all expected skill IDs', () => {
		expect( BUNDLED_SKILL_IDS ).toEqual( [
			'wp-plugin-development',
			'wp-block-development',
			'wp-block-themes',
			'wp-rest-api',
			'wp-wpcli-and-ops',
		] );
	} );
} );

describe( 'installSkillsToSite', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( true );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.symlink ).mockResolvedValue( undefined );
	} );

	it( 'skips copy but still creates symlink when SKILL.md exists and overwrite is false', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			// Source exists, SKILL.md exists, but symlink does not exist
			if ( p.includes( '.claude' ) ) {
				return false;
			}
			return true;
		} );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		// Should not copy since SKILL.md exists
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		// Should still create symlinks
		expect( fs.symlink ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'installs skills when not present', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p.endsWith( 'SKILL.md' ) || p.includes( '.claude' ) ) {
				return false;
			}
			return true;
		} );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 5 );
		expect( fs.symlink ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'creates symlink with correct relative path', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p.endsWith( 'SKILL.md' ) || p.includes( '.claude' ) ) {
				return false;
			}
			return true;
		} );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		const expectedRelativePath = path.relative(
			path.join( SITE_PATH, '.claude', 'skills' ),
			path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' )
		);
		expect( fs.symlink ).toHaveBeenCalledWith(
			expectedRelativePath,
			path.join( SITE_PATH, '.claude', 'skills', 'wp-plugin-development' )
		);
	} );

	it( 'removes existing files when overwrite is true', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, true );

		expect( fs.rm ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' ),
			{ recursive: true, force: true }
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'skips skills whose source does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.symlink ).not.toHaveBeenCalled();
	} );

	it( 'falls back to junction on Windows EPERM', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p.endsWith( 'SKILL.md' ) || p.includes( '.claude' ) ) {
				return false;
			}
			return true;
		} );

		const epermError = Object.assign( new Error( 'EPERM' ), { code: 'EPERM' } );
		vi.mocked( fs.symlink )
			.mockRejectedValueOnce( epermError ) // First call fails with EPERM
			.mockResolvedValue( undefined ); // Junction fallback succeeds

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		// First skill should have used junction fallback
		expect( fs.symlink ).toHaveBeenCalledWith(
			path.resolve( path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' ) ),
			path.join( SITE_PATH, '.claude', 'skills', 'wp-plugin-development' ),
			'junction'
		);

		Object.defineProperty( process, 'platform', { value: originalPlatform } );
	} );
} );
