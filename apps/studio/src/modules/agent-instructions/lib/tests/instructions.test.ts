import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	getInstructionFilePath,
	getInstructionFileStatus,
	getAllInstructionFilesStatus,
} from 'src/modules/agent-instructions/lib/instructions';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		readFile: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/server-files-paths', () => ( {
	getAiInstructionsPath: () => '/test/bundled-skills',
} ) );

const SITE_PATH = '/test/my-site';

describe( 'getInstructionFilePath', () => {
	it( 'returns correct path for agents file', () => {
		expect( getInstructionFilePath( SITE_PATH, 'agents' ) ).toBe(
			path.join( SITE_PATH, 'AGENTS.md' )
		);
	} );

	it( 'returns correct path for studio file', () => {
		expect( getInstructionFilePath( SITE_PATH, 'studio' ) ).toBe(
			path.join( SITE_PATH, 'STUDIO.md' )
		);
	} );
} );

describe( 'getInstructionFileStatus', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns exists: false when file is not accessible', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( false );
		expect( status.id ).toBe( 'agents' );
		expect( status.fileName ).toBe( 'AGENTS.md' );
		expect( status.path ).toBe( path.join( SITE_PATH, 'AGENTS.md' ) );
	} );

	it( 'returns exists: true when file is accessible', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( 'file content' );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
	} );
} );

describe( 'getAllInstructionFilesStatus', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns status for all instruction file types', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		const statuses = await getAllInstructionFilesStatus( SITE_PATH );

		expect( statuses ).toHaveLength( 2 );
		expect( statuses.map( ( s ) => s.id ) ).toEqual( [ 'agents', 'studio' ] );
	} );
} );
