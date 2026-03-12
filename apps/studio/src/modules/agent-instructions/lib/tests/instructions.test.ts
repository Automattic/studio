import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	DEFAULT_AGENT_INSTRUCTIONS,
	DEFAULT_INSTRUCTIONS_MAP,
} from 'src/modules/agent-instructions/constants';
import {
	getInstructionFilePath,
	getInstructionFileStatus,
	getAllInstructionFilesStatus,
	installInstructionFile,
	installAllInstructionFiles,
} from 'src/modules/agent-instructions/lib/instructions';

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
	},
} ) );

const SITE_PATH = '/test/my-site';
const CUSTOM_CONTENT = `# My custom AI Instructions\n`;

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

	it( 'returns isCustomized: false when agents file matches the default template', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( DEFAULT_AGENT_INSTRUCTIONS as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.isCustomized ).toBe( false );
	} );

	it( 'returns isCustomized: false when studio file matches the default template', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( DEFAULT_INSTRUCTIONS_MAP.studio as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'studio' );

		expect( status.exists ).toBe( true );
		expect( status.isCustomized ).toBe( false );
	} );

	it( 'returns isCustomized: true when file content differs from the default template', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( CUSTOM_CONTENT as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.isCustomized ).toBe( true );
	} );

	it( 'returns isCustomized: true when file has an outdated Studio version', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue(
			`<!-- Studio Instructions Version: 19990101.1 -->\n# AI Instructions\n` as never
		);

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.isCustomized ).toBe( true );
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

describe( 'installInstructionFile', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'writes file and returns overwritten: false when file does not exist', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.writeFile ).mockResolvedValue( undefined );

		const result = await installInstructionFile( SITE_PATH, 'agents', 'content', false );

		expect( fs.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'AGENTS.md' ),
			'content',
			'utf-8'
		);
		expect( result.overwritten ).toBe( false );
	} );

	it( 'writes studio file when file does not exist', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.writeFile ).mockResolvedValue( undefined );

		const result = await installInstructionFile( SITE_PATH, 'studio', 'studio content', false );

		expect( fs.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'STUDIO.md' ),
			'studio content',
			'utf-8'
		);
		expect( result.overwritten ).toBe( false );
	} );

	it( 'skips write and returns overwritten: false when file exists and overwrite is false', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );

		const result = await installInstructionFile( SITE_PATH, 'agents', 'content', false );

		expect( fs.writeFile ).not.toHaveBeenCalled();
		expect( result.overwritten ).toBe( false );
	} );

	it( 'overwrites file and returns overwritten: true when overwrite is true', async () => {
		vi.mocked( fs.writeFile ).mockResolvedValue( undefined );

		const result = await installInstructionFile( SITE_PATH, 'agents', 'content', true );

		expect( fs.writeFile ).toHaveBeenCalled();
		expect( result.overwritten ).toBe( true );
	} );
} );

describe( 'installAllInstructionFiles', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'installs all instruction files and returns results for each', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );
		vi.mocked( fs.writeFile ).mockResolvedValue( undefined );

		const results = await installAllInstructionFiles( SITE_PATH, 'content', false );

		expect( results ).toHaveLength( 2 );
		expect( results.map( ( r ) => r.fileType ) ).toEqual( [ 'agents', 'studio' ] );
		expect( fs.writeFile ).toHaveBeenCalledTimes( 2 );
	} );
} );
