import { vi, type Mock } from 'vitest';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import { getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		getAuthToken: vi.fn(),
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( 'cli/lib/snapshots' );
vi.mock( 'cli/logger' );

describe( 'Preview List Command', () => {
	const mockFolder = '/test/folder';
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockSite = {
		id: 'site-1',
		path: mockFolder,
		title: 'Test Site',
	};
	const mockSnapshots = [
		{
			url: 'test1.example.com',
			atomicSiteId: 123,
			localSiteId: '456',
			date: Date.now(),
			name: 'Test Snapshot 1',
			userId: 789,
		},
		{
			url: 'test2.example.com',
			atomicSiteId: 124,
			localSiteId: '457',
			date: Date.now(),
			name: 'Test Snapshot 2',
			userId: 789,
		},
	];

	let mockLogger: {
		reportStart: Mock;
		reportSuccess: Mock;
		reportError: Mock;
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		mockLogger = {
			reportStart: vi.fn(),
			reportSuccess: vi.fn(),
			reportError: vi.fn(),
		};

		( Logger as Mock ).mockReturnValue( mockLogger );
		( getSiteByFolder as Mock ).mockResolvedValue( mockSite );
		( getAuthToken as Mock ).mockResolvedValue( mockAuthToken );
		( getSnapshotsFromAppdata as Mock ).mockResolvedValue( mockSnapshots );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should list preview sites successfully', async () => {
		const { runCommand } = await import( '../list' );
		await runCommand( mockFolder, 'table' );

		expect( getSiteByFolder ).toHaveBeenCalledWith( mockFolder );
		expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( mockAuthToken.id, mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'load',
			'Loading preview sites…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Found 2 preview sites' ] );
	} );

	it( 'should handle validation errors', async () => {
		const { runCommand } = await import( '../list' );
		( getSiteByFolder as Mock ).mockImplementation( () => {
			throw new Error( 'Invalid site folder' );
		} );

		await runCommand( mockFolder, 'table' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );

	it( 'should handle no snapshots found', async () => {
		const { runCommand } = await import( '../list' );
		( getSnapshotsFromAppdata as Mock ).mockResolvedValue( [] );

		await runCommand( mockFolder, 'table' );

		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'load',
			'Loading preview sites…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'No preview sites found' ] );
	} );
} );
