import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	BUNDLED_SKILLS,
	getSkillsStatus,
	installAllSkills,
} from 'src/modules/agent-instructions/lib/skills';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/server-files-paths', () => ( {
	getAgentSkillsPath: () => '/mock/server-files/agent-skills',
} ) );

vi.mock( '@studio/common/lib/agent-skills', async ( importOriginal ) => {
	const original = await importOriginal< typeof import('@studio/common/lib/agent-skills') >();
	return {
		...original,
		installSkillsToSite: vi.fn(),
	};
} );

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

describe( 'installAllSkills', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'delegates to shared installSkillsToSite', async () => {
		const { installSkillsToSite } = await import( '@studio/common/lib/agent-skills' );

		await installAllSkills( SITE_PATH, true );

		expect( installSkillsToSite ).toHaveBeenCalledWith(
			SITE_PATH,
			'/mock/server-files/agent-skills',
			true
		);
	} );
} );
