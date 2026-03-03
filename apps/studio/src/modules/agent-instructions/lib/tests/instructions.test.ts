import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import {
	AGENT_INSTRUCTIONS_VERSION,
	extractInstructionVersion,
	isInstructionVersionOutdated,
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
const VERSIONED_CONTENT = `<!-- Studio Instructions Version: ${ AGENT_INSTRUCTIONS_VERSION } -->\n# AI Instructions\n`;
const OUTDATED_CONTENT = `<!-- Studio Instructions Version: 19990101.1 -->\n# AI Instructions\n`;
const UNVERSIONED_CONTENT = `# AI Instructions\n`;

describe( 'extractInstructionVersion', () => {
	it( 'extracts version from versioned content', () => {
		expect( extractInstructionVersion( VERSIONED_CONTENT ) ).toBe( AGENT_INSTRUCTIONS_VERSION );
	} );

	it( 'returns null for content without a version comment', () => {
		expect( extractInstructionVersion( UNVERSIONED_CONTENT ) ).toBeNull();
	} );
} );

describe( 'isInstructionVersionOutdated', () => {
	it( 'returns false for the current version', () => {
		expect( isInstructionVersionOutdated( AGENT_INSTRUCTIONS_VERSION ) ).toBe( false );
	} );

	it( 'returns true for an old version', () => {
		expect( isInstructionVersionOutdated( '19990101.1' ) ).toBe( true );
	} );

	it( 'returns true for null (no version installed)', () => {
		expect( isInstructionVersionOutdated( null ) ).toBe( true );
	} );
} );

describe( 'getInstructionFilePath', () => {
	it( 'returns correct path for agents file', () => {
		expect( getInstructionFilePath( SITE_PATH, 'agents' ) ).toBe(
			path.join( SITE_PATH, 'AGENTS.md' )
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

	it( 'returns exists: true with current version when file is up to date', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( VERSIONED_CONTENT as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.version ).toBe( AGENT_INSTRUCTIONS_VERSION );
		expect( status.isOutdated ).toBe( false );
	} );

	it( 'returns isOutdated: true when file has an older version', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( OUTDATED_CONTENT as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.isOutdated ).toBe( true );
	} );

	it( 'returns isOutdated: true when file has no version comment', async () => {
		vi.mocked( fs.access ).mockResolvedValue( undefined );
		vi.mocked( fs.readFile ).mockResolvedValue( UNVERSIONED_CONTENT as never );

		const status = await getInstructionFileStatus( SITE_PATH, 'agents' );

		expect( status.exists ).toBe( true );
		expect( status.version ).toBeNull();
		expect( status.isOutdated ).toBe( true );
	} );
} );

describe( 'getAllInstructionFilesStatus', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns status for all instruction file types', async () => {
		vi.mocked( fs.access ).mockRejectedValue( new Error( 'ENOENT' ) );

		const statuses = await getAllInstructionFilesStatus( SITE_PATH );

		expect( statuses ).toHaveLength( 1 );
		expect( statuses.map( ( s ) => s.id ) ).toEqual( [ 'agents' ] );
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

		expect( results ).toHaveLength( 1 );
		expect( results.map( ( r ) => r.fileType ) ).toEqual( [ 'agents' ] );
		expect( fs.writeFile ).toHaveBeenCalledTimes( 1 );
	} );
} );
