import { confirm } from '@inquirer/prompts';
import {
	readAppdata,
	saveAppdata,
	lockAppdata,
	unlockAppdata,
	getSiteByFolder,
} from 'cli/lib/appdata';
import { validateReadSitePath } from 'cli/lib/validation';
import { Logger } from 'cli/logger';

jest.mock( '@inquirer/prompts' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	lockAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
	getSiteByFolder: jest.fn(),
} ) );
jest.mock( 'cli/lib/validation' );
jest.mock( 'cli/logger' );
jest.mock( 'trash' );

describe( 'Sites Delete Command', () => {
	const mockSitePath = '/test/site';
	const mockSiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSitePath,
	};
	const mockAppdata = {
		sites: [ mockSiteData ],
		newSites: [],
		snapshots: [],
	};

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();
		jest.spyOn( console, 'log' ).mockImplementation( () => {} );
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		jest.spyOn( process, 'exit' ).mockImplementation( ( code ) => {
			throw new Error( `Process exited with code ${ code }` );
		} );

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );
		( validateReadSitePath as jest.Mock ).mockReturnValue( { valid: true } );
		( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
		( readAppdata as jest.Mock ).mockResolvedValue( { ...mockAppdata } );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should delete site successfully without deleting files', async () => {
		( confirm as jest.Mock )
			.mockResolvedValueOnce( true ) // Confirm deletion
			.mockResolvedValueOnce( false ); // Don't delete files

		const { runCommand } = await import( '../delete' );
		await runCommand( mockSitePath );

		expect( validateReadSitePath ).toHaveBeenCalledWith( mockSitePath );
		expect( getSiteByFolder ).toHaveBeenCalledWith( mockSitePath );
		expect( confirm ).toHaveBeenCalledTimes( 2 );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'appdata', 'Deleting site...' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'Site "Test Site" deleted successfully'
		);
		expect( saveAppdata ).toHaveBeenCalledWith( {
			...mockAppdata,
			sites: [],
			newSites: [],
		} );
	} );

	it( 'should delete site and files when confirmed', async () => {
		const mockTrash = jest.fn().mockResolvedValue( undefined );
		jest.doMock( 'trash', () => ( { default: mockTrash } ) );

		( confirm as jest.Mock )
			.mockResolvedValueOnce( true ) // Confirm deletion
			.mockResolvedValueOnce( true ); // Delete files

		const { runCommand } = await import( '../delete' );
		await runCommand( mockSitePath );

		expect( validateReadSitePath ).toHaveBeenCalledWith( mockSitePath );
		expect( getSiteByFolder ).toHaveBeenCalledWith( mockSitePath );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Site files moved to trash' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'Site "Test Site" deleted successfully'
		);
	} );

	it( 'should handle validation errors', async () => {
		( validateReadSitePath as jest.Mock ).mockReturnValue( {
			valid: false,
			error: 'Invalid WordPress directory',
		} );

		const { runCommand } = await import( '../delete' );

		await expect( () => runCommand( mockSitePath ) ).rejects.toThrow(
			'Process exited with code 1'
		);
		expect( getSiteByFolder ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle site not found error', async () => {
		( getSiteByFolder as jest.Mock ).mockRejectedValue(
			new Error( 'The specified folder is not added to Studio.' )
		);

		const { runCommand } = await import( '../delete' );

		await expect( () => runCommand( mockSitePath ) ).rejects.toThrow(
			'Process exited with code 1'
		);
		expect( saveAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should cancel when user declines confirmation', async () => {
		( confirm as jest.Mock ).mockResolvedValueOnce( false ); // Don't confirm deletion

		const { runCommand } = await import( '../delete' );
		await runCommand( mockSitePath );

		expect( confirm ).toHaveBeenCalledTimes( 1 );
		expect( mockLogger.reportStart ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle file deletion errors gracefully', async () => {
		const mockTrash = jest.fn().mockRejectedValue( new Error( 'Trash failed' ) );
		jest.doMock( 'trash', () => ( { default: mockTrash } ) );

		// Mock fs.promises.rm to also fail
		const mockFsRm = jest.fn().mockRejectedValue( new Error( 'FS remove failed' ) );
		jest.doMock(
			'fs',
			() => ( {
				promises: { rm: mockFsRm },
			} ),
			{ virtual: true }
		);

		( confirm as jest.Mock )
			.mockResolvedValueOnce( true ) // Confirm deletion
			.mockResolvedValueOnce( true ); // Delete files

		const { runCommand } = await import( '../delete' );
		await runCommand( mockSitePath );

		// Should still succeed even if file deletion fails
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'Site "Test Site" deleted successfully'
		);
		expect( saveAppdata ).toHaveBeenCalled();
	} );

	it( 'should remove site from both sites and newSites arrays', async () => {
		const mockAppdataWithNewSites = {
			sites: [ mockSiteData ],
			newSites: [ { ...mockSiteData, id: 'other-id' } ],
			snapshots: [],
		};
		( readAppdata as jest.Mock ).mockResolvedValue( mockAppdataWithNewSites );

		( confirm as jest.Mock )
			.mockResolvedValueOnce( true ) // Confirm deletion
			.mockResolvedValueOnce( false ); // Don't delete files

		const { runCommand } = await import( '../delete' );
		await runCommand( mockSitePath );

		expect( saveAppdata ).toHaveBeenCalledWith( {
			...mockAppdataWithNewSites,
			sites: [],
			newSites: [ { ...mockSiteData, id: 'other-id' } ],
		} );
	} );

	it( 'should handle TTY errors gracefully', async () => {
		const ttyError: Error & { isTTYError?: boolean } = new Error( 'TTY Error' );
		ttyError.isTTYError = true;
		( validateReadSitePath as jest.Mock ).mockImplementation( () => {
			throw ttyError;
		} );

		const { runCommand } = await import( '../delete' );

		await expect( () => runCommand( mockSitePath ) ).rejects.toThrow(
			'Process exited with code 1'
		);
		expect( console.error ).toHaveBeenCalledWith( 'This command requires an interactive terminal' );
	} );
} );
