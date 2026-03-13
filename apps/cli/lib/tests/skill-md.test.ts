import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { writeSkillMd } from 'cli/lib/skill-md';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn(),
		promises: {
			writeFile: vi.fn(),
			mkdir: vi.fn(),
			symlink: vi.fn(),
		},
	},
} ) );

describe( 'writeSkillMd', () => {
	const sitePath = '/test/my-site';
	const expectedSkillDir = path.join( sitePath, '.agents', 'skills', 'studio-cli' );
	const expectedSkillMdPath = path.join( expectedSkillDir, 'SKILL.md' );
	const expectedClaudeSkillsDir = path.join( sitePath, '.claude', 'skills' );
	const expectedSymlinkPath = path.join( expectedClaudeSkillsDir, 'studio-cli' );
	const expectedRelativeTarget = path.relative( expectedClaudeSkillsDir, expectedSkillDir );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
	} );

	it( 'writes SKILL.md to .agents/skills/studio-cli/ when none exists', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );

		await writeSkillMd( sitePath );

		expect( fs.promises.mkdir ).toHaveBeenCalledWith( expectedSkillDir, { recursive: true } );
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			expectedSkillMdPath,
			expect.stringContaining( '# Studio CLI' ),
			'utf-8'
		);
	} );

	it( 'writes nothing when both SKILL.md and symlink exist', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( true );

		await writeSkillMd( sitePath );

		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'does not overwrite SKILL.md but creates symlink when only SKILL.md exists', async () => {
		vi.mocked( fs.existsSync ).mockImplementation( ( filePath ) => {
			return filePath === expectedSkillMdPath;
		} );

		await writeSkillMd( sitePath );

		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			expectedRelativeTarget,
			expectedSymlinkPath
		);
	} );

	it( 'does not overwrite symlink but creates SKILL.md when only symlink exists', async () => {
		vi.mocked( fs.existsSync ).mockImplementation( ( filePath ) => {
			return filePath === expectedSymlinkPath;
		} );

		await writeSkillMd( sitePath );

		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			expectedSkillMdPath,
			expect.stringContaining( '# Studio CLI' ),
			'utf-8'
		);
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'creates .claude/skills symlink pointing to .agents/skills/studio-cli', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );

		await writeSkillMd( sitePath );

		expect( fs.promises.mkdir ).toHaveBeenCalledWith( expectedClaudeSkillsDir, {
			recursive: true,
		} );
		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			expectedRelativeTarget,
			expectedSymlinkPath
		);
	} );

	it( 'writes content covering Studio CLI commands', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );

		await writeSkillMd( sitePath );

		const writtenContent = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( writtenContent ).toContain( 'studio site start' );
		expect( writtenContent ).toContain( 'studio site stop' );
		expect( writtenContent ).toContain( 'studio wp' );
		expect( writtenContent ).toContain( 'studio preview create' );
		expect( writtenContent ).toContain( 'studio auth login' );
	} );

	it( 'includes skill frontmatter', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );

		await writeSkillMd( sitePath );

		const writtenContent = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( writtenContent ).toContain( 'name: studio-cli' );
		expect( writtenContent ).toContain( 'description: Use the Studio CLI' );
	} );
} );
