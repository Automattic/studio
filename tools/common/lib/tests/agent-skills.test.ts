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
		vi.mocked( fs.lstat ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.symlink ).mockResolvedValue( undefined );
	} );

	it( 'skips installation when skill SKILL.md exists and overwrite is false', async () => {
		// First pathExists call: source exists. Second: SKILL.md exists.
		vi.mocked( pathExists )
			.mockResolvedValueOnce( true ) // src exists
			.mockResolvedValueOnce( true ); // SKILL.md exists — skip

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		// Should not copy for the first skill since it's already installed
		expect( recursiveCopyDirectory ).not.toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'wp-plugin-development' ),
			expect.any( String )
		);
	} );

	it( 'installs skills when not present', async () => {
		// Source exists, SKILL.md does not
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p.endsWith( 'SKILL.md' ) ) {
				return false;
			}
			return true;
		} );

		await installSkillsToSite( SITE_PATH, BUNDLED_PATH, false );

		// Should copy all 5 skills
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 5 );
		// Should create symlinks for all 5 skills
		expect( fs.symlink ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'creates symlink with correct relative path', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p.endsWith( 'SKILL.md' ) ) {
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
		vi.mocked( fs.lstat ).mockResolvedValue( {} as never );

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
} );
