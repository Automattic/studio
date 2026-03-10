import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	BUNDLED_SKILLS,
	getSkillsStatus,
	installSkill,
	installAllSkills,
} from 'src/modules/agent-instructions/lib/skills';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		mkdir: vi.fn(),
		readdir: vi.fn(),
		copyFile: vi.fn(),
		rm: vi.fn(),
		lstat: vi.fn(),
		symlink: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/server-files-paths', () => ( {
	getAgentSkillsPath: () => '/mock/server-files/agent-skills',
} ) );

const SITE_PATH = '/test/my-site';

describe( 'BUNDLED_SKILLS', () => {
	it( 'contains exactly 5 skills', () => {
		expect( BUNDLED_SKILLS ).toHaveLength( 5 );
	} );

	it( 'includes all expected skill IDs', () => {
		const ids = BUNDLED_SKILLS.map( ( s ) => s.id );
		expect( ids ).toEqual( [
			'wp-plugin-development',
			'wp-block-development',
			'wp-block-themes',
			'wp-rest-api',
			'wp-wpcli-and-ops',
		] );
	} );
} );

describe( 'getSkillsStatus', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns installed: false when skill directory does not exist', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		const statuses = await getSkillsStatus( SITE_PATH );

		expect( statuses ).toHaveLength( 5 );
		expect( statuses.every( ( s ) => ! s.installed ) ).toBe( true );
	} );

	it( 'returns installed: true when SKILL.md exists', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );

		const statuses = await getSkillsStatus( SITE_PATH );

		expect( statuses ).toHaveLength( 5 );
		expect( statuses.every( ( s ) => s.installed ) ).toBe( true );
	} );

	it( 'checks for SKILL.md in each skill directory', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		await getSkillsStatus( SITE_PATH );

		expect( fs.access ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development', 'SKILL.md' )
		);
		expect( fs.access ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api', 'SKILL.md' )
		);
	} );
} );

describe( 'installSkill', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.readdir ).mockResolvedValue( [] as never );
		vi.mocked( fs.copyFile ).mockResolvedValue( undefined );
		vi.mocked( fs.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.lstat ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.symlink ).mockResolvedValue( undefined );
	} );

	it( 'skips installation when skill already exists and overwrite is false', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );

		await installSkill( SITE_PATH, 'wp-rest-api', false );

		expect( fs.symlink ).not.toHaveBeenCalled();
	} );

	it( 'creates symlink with correct relative path', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		await installSkill( SITE_PATH, 'wp-rest-api', false );

		const expectedRelativePath = path.relative(
			path.join( SITE_PATH, '.claude', 'skills' ),
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api' )
		);
		expect( fs.symlink ).toHaveBeenCalledWith(
			expectedRelativePath,
			path.join( SITE_PATH, '.claude', 'skills', 'wp-rest-api' )
		);
	} );

	it( 'removes existing files when overwrite is true', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.lstat ).mockResolvedValue( {} as never );

		await installSkill( SITE_PATH, 'wp-rest-api', true );

		expect( fs.rm ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api' ),
			{ recursive: true, force: true }
		);
	} );
} );

describe( 'installAllSkills', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.readdir ).mockResolvedValue( [] as never );
		vi.mocked( fs.copyFile ).mockResolvedValue( undefined );
		vi.mocked( fs.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.lstat ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.symlink ).mockResolvedValue( undefined );
	} );

	it( 'installs all 5 skills', async () => {
		await installAllSkills( SITE_PATH, false );

		// Should create symlinks for all 5 skills
		expect( fs.symlink ).toHaveBeenCalledTimes( 5 );
	} );
} );
