import { vi } from 'vitest';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import { getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../list';

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
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = mockReportStart;
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportProgress = mockReportProgress;
		reportWarning = mockReportWarning;
		reportKeyValuePair = mockReportKeyValuePair;
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'Preview List Command', () => {
	const mockFolder = '/test/folder';
	const mockAuthToken = {
		accessToken: 'mock-auth-token',
		id: 123,
		email: 'test@example.com',
		displayName: 'Test User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};
	const mockSite = {
		id: 'site-1',
		path: mockFolder,
		name: 'Test Site',
		phpVersion: '8.0',
		port: 8888,
		running: false,
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

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		vi.mocked( getSiteByFolder ).mockResolvedValue( mockSite );
		vi.mocked( getAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( mockSnapshots );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should list preview sites successfully', async () => {
		await runCommand( mockFolder, 'table' );

		expect( getSiteByFolder ).toHaveBeenCalledWith( mockFolder );
		expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( mockAuthToken.id, mockFolder );
		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'load', 'Loading preview sites…' ] );
		expect( mockReportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Found 2 preview sites' ] );
	} );

	it( 'should handle validation errors', async () => {
		vi.mocked( getSiteByFolder ).mockImplementation( () => {
			throw new Error( 'Invalid site folder' );
		} );

		await runCommand( mockFolder, 'table' );

		expect( mockReportError ).toHaveBeenCalled();
	} );

	it( 'should handle no snapshots found', async () => {
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

		await runCommand( mockFolder, 'table' );

		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'load', 'Loading preview sites…' ] );
		expect( mockReportSuccess.mock.calls[ 1 ] ).toEqual( [ 'No preview sites found' ] );
	} );
} );
