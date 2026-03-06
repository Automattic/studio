import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { writeAgentsMd } from 'cli/lib/agents-md';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn(),
		promises: {
			writeFile: vi.fn(),
		},
	},
} ) );

describe( 'writeAgentsMd', () => {
	const sitePath = '/test/my-site';
	const expectedFilePath = path.join( sitePath, 'AGENTS.md' );

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'writes AGENTS.md when none exists', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );

		await writeAgentsMd( sitePath );

		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			expectedFilePath,
			expect.stringContaining( '# AI Instructions' ),
			'utf-8'
		);
	} );

	it( 'does not overwrite an existing AGENTS.md', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( true );

		await writeAgentsMd( sitePath );

		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
	} );

	it( 'writes content covering Studio CLI commands', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );

		await writeAgentsMd( sitePath );

		const writtenContent = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( writtenContent ).toContain( 'studio site start' );
		expect( writtenContent ).toContain( 'studio site stop' );
		expect( writtenContent ).toContain( 'studio wp' );
		expect( writtenContent ).toContain( 'studio preview create' );
		expect( writtenContent ).toContain( 'studio auth login' );
	} );

	it( 'writes content covering SQLite database specifics', async () => {
		vi.mocked( fs.existsSync ).mockReturnValue( false );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );

		await writeAgentsMd( sitePath );

		const writtenContent = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( writtenContent ).toContain( 'SQLite' );
		expect( writtenContent ).toContain( 'wp-content/database/.ht.sqlite' );
		expect( writtenContent ).toContain( 'wp-content/db.php' );
		expect( writtenContent ).toContain( 'sqlite-database-integration' );
	} );
} );
