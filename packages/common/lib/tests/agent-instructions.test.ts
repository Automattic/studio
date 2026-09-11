import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	getAllInstructionFilesStatus,
	getInstructionFilePath,
	getInstructionFileStatus,
	installInstructionFile,
	removeInstructionFile,
} from '../agent-instructions';
import { pathExists } from '../fs-utils';

vi.mock( 'fs/promises', () => ( {
	default: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		rm: vi.fn(),
	},
} ) );

vi.mock( '../fs-utils', () => ( {
	pathExists: vi.fn(),
} ) );

const SITE_PATH = '/test/my-site';
const BUNDLED_PATH = '/mock/server-files/skills';

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

	it( 'returns exists: false when file does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( false );
		expect( status.id ).toBe( 'agents' );
		expect( status.fileName ).toBe( 'AGENTS.md' );
		expect( status.path ).toBe( path.join( SITE_PATH, 'AGENTS.md' ) );
	} );

	it( 'returns exists: true when file exists', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
	} );
} );

describe( 'getAllInstructionFilesStatus', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns status for all instruction file types', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		const statuses = await getAllInstructionFilesStatus( SITE_PATH );

		expect( statuses ).toHaveLength( 3 );
		expect( statuses.map( ( s ) => s.id ) ).toEqual( [ 'agents', 'claude', 'studio' ] );
	} );
} );

describe( 'installInstructionFile', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.readFile ).mockResolvedValue( 'bundled content' );
		vi.mocked( fs.writeFile ).mockResolvedValue( undefined );
	} );

	it( 'writes the bundled content when the file does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		const result = await installInstructionFile( SITE_PATH, 'agents', BUNDLED_PATH, false );

		expect( fs.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'AGENTS.md' ),
			'bundled content',
			'utf-8'
		);
		expect( result ).toEqual( { path: path.join( SITE_PATH, 'AGENTS.md' ), overwritten: false } );
	} );

	it( 'skips writing when the file exists and overwrite is false', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		const result = await installInstructionFile( SITE_PATH, 'agents', BUNDLED_PATH, false );

		expect( fs.writeFile ).not.toHaveBeenCalled();
		expect( result.overwritten ).toBe( false );
	} );

	it( 'overwrites an existing file when overwrite is true', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		const result = await installInstructionFile( SITE_PATH, 'agents', BUNDLED_PATH, true );

		expect( fs.writeFile ).toHaveBeenCalled();
		expect( result.overwritten ).toBe( true );
	} );

	it( 'throws when the bundled content is missing', async () => {
		vi.mocked( fs.readFile ).mockRejectedValue( new Error( 'ENOENT' ) );

		await expect(
			installInstructionFile( SITE_PATH, 'agents', BUNDLED_PATH, false )
		).rejects.toThrow( 'Bundled content not found for agents' );
	} );
} );

describe( 'removeInstructionFile', () => {
	it( 'removes the file at the site path', async () => {
		vi.mocked( fs.rm ).mockResolvedValue( undefined );

		await removeInstructionFile( SITE_PATH, 'claude' );

		expect( fs.rm ).toHaveBeenCalledWith( path.join( SITE_PATH, 'CLAUDE.md' ), { force: true } );
	} );
} );
