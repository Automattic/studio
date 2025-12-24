import { BlueprintV1Declaration } from '@wp-playground/blueprints';
import {
	filterUnsupportedBlueprintFeatures,
	validateBlueprintData,
} from 'common/lib/blueprint-validation';
import { isEmptyDir, isWordPressDirectory, pathExists, arePathsEqual } from 'common/lib/fs-utils';
import { portFinder } from 'common/lib/port-finder';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata, SiteData } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { isSqliteIntegrationAvailable, installSqliteIntegration } from 'cli/lib/sqlite-integration';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../create';

jest.mock( 'common/lib/fs-utils' );
jest.mock( 'common/lib/port-finder', () => ( {
	portFinder: {
		addUnavailablePort: jest.fn(),
		getOpenPort: jest.fn(),
	},
} ) );
jest.mock( 'common/lib/passwords', () => ( {
	createPassword: jest.fn().mockReturnValue( 'generated-password-123' ),
} ) );
jest.mock( 'common/lib/blueprint-validation' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	lockAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
	getSiteUrl: jest.fn( ( site ) => `http://localhost:${ site.port }` ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/sqlite-integration' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site create', () => {
	const mockSitePath = '/test/site/new-site';
	const mockPort = 8881;

	const mockAppdata = {
		sites: [] as SiteData[],
		snapshots: [],
	};

	const mockExistingSite: SiteData = {
		id: 'existing-site-id',
		name: 'Existing Site',
		path: '/test/site/existing',
		port: 8882,
		adminUsername: 'admin',
		adminPassword: 'existing-password',
		running: false,
		phpVersion: '8.0',
	};

	const mockProcessDescription = {
		name: 'test-uuid-1234',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	let consoleLogSpy: jest.SpyInstance;
	let fsMkdirSyncSpy: jest.SpyInstance;

	beforeEach( () => {
		jest.clearAllMocks();

		consoleLogSpy = jest.spyOn( console, 'log' ).mockImplementation();
		fsMkdirSyncSpy = jest.spyOn( require( 'fs' ), 'mkdirSync' ).mockReturnValue( undefined );
		( pathExists as jest.Mock ).mockResolvedValue( false );
		( isEmptyDir as jest.Mock ).mockResolvedValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( false );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a, b ) => a === b );
		( portFinder.getOpenPort as jest.Mock ).mockResolvedValue( mockPort );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ ...mockAppdata.sites ],
			snapshots: [ ...mockAppdata.snapshots ],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isSqliteIntegrationAvailable as jest.Mock ).mockResolvedValue( true );
		( installSqliteIntegration as jest.Mock ).mockResolvedValue( undefined );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( setupCustomDomain as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( runBlueprint as jest.Mock ).mockResolvedValue( undefined );
		( logSiteDetails as jest.Mock ).mockImplementation( () => {} );
		( openSiteInBrowser as jest.Mock ).mockResolvedValue( undefined );
		( validateBlueprintData as jest.Mock ).mockResolvedValue( { valid: true, warnings: [] } );
		( filterUnsupportedBlueprintFeatures as jest.Mock ).mockImplementation(
			( blueprint ) => blueprint
		);
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Validation Errors', () => {
		it( 'should error if directory exists and is not empty nor a WordPress site', async () => {
			( pathExists as jest.Mock ).mockResolvedValue( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( false );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'The selected directory is not empty nor an existing WordPress site.' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if WordPress version is invalid', async () => {
			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'invalid-version',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'Invalid WordPress version' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if WordPress version is below minimum', async () => {
			await expect(
				runCommand( mockSitePath, {
					wpVersion: '6.0',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'WordPress version must be at least' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if site path is already in use', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockExistingSite ],
				snapshots: [],
			} );
			( arePathsEqual as jest.Mock ).mockReturnValue( true );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'The selected directory is already in use.' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if custom domain is invalid', async () => {
			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					customDomain: 'invalid-domain-without-tld',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if custom domain is already in use', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...mockExistingSite, customDomain: 'mysite.local' } ],
				snapshots: [],
			} );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					customDomain: 'mysite.local',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if blueprint validation fails', async () => {
			( validateBlueprintData as jest.Mock ).mockResolvedValue( {
				valid: false,
				error: 'Invalid blueprint',
			} );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					blueprintJson: {},
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'Invalid blueprint' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if SQLite integration is not available', async () => {
			( isSqliteIntegrationAvailable as jest.Mock ).mockResolvedValue( false );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'SQLite integration files not found' );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should create a basic site successfully', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( fsMkdirSyncSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true } );
			expect( isSqliteIntegrationAvailable ).toHaveBeenCalled();
			expect( installSqliteIntegration ).toHaveBeenCalledWith( mockSitePath );
			expect( portFinder.getOpenPort ).toHaveBeenCalled();
			expect( lockAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			expect( connect ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalled();
			expect( openSiteInBrowser ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should create site with custom name', async () => {
			await runCommand( mockSitePath, {
				name: 'My Custom Site',
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							name: 'My Custom Site',
						} ),
					] ),
				} )
			);
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( {
					blueprint: expect.objectContaining( {
						steps: expect.arrayContaining( [
							expect.objectContaining( {
								step: 'setSiteOptions',
								options: { blogname: 'My Custom Site' },
							} ),
						] ),
					} ),
				} )
			);
		} );

		it( 'should use folder name as site name if no name provided', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							name: 'new-site',
						} ),
					] ),
				} )
			);
		} );

		it( 'should create site in existing empty directory', async () => {
			( pathExists as jest.Mock ).mockResolvedValue( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( true );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site in existing WordPress directory', async () => {
			( pathExists as jest.Mock ).mockResolvedValue( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site with custom domain', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				customDomain: 'mysite.local',
				enableHttps: false,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							customDomain: 'mysite.local',
						} ),
					] ),
				} )
			);
			expect( setupCustomDomain ).toHaveBeenCalled();
		} );

		it( 'should create site with HTTPS enabled', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				customDomain: 'mysite.local',
				enableHttps: true,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							enableHttps: true,
						} ),
					] ),
				} )
			);
		} );

		it( 'should add existing site ports to unavailable ports', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockExistingSite ],
				snapshots: [],
			} );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( mockExistingSite.port );
		} );

		it( 'should set isWpAutoUpdating true for latest WordPress version', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							isWpAutoUpdating: true,
						} ),
					] ),
				} )
			);
		} );

		it( 'should set isWpAutoUpdating false for specific WordPress version', async () => {
			await runCommand( mockSitePath, {
				wpVersion: '6.4',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							isWpAutoUpdating: false,
						} ),
					] ),
				} )
			);
		} );
	} );

	describe( 'Blueprint Handling', () => {
		const testBlueprint: BlueprintV1Declaration = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
			],
		};

		it( 'should apply blueprint when provided', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				blueprintJson: testBlueprint,
				enableHttps: false,
				noStart: false,
			} );

			expect( validateBlueprintData ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( {
					blueprint: expect.any( Object ),
				} )
			);
		} );

		it( 'should prepend setSiteOptions step when name is provided with blueprint', async () => {
			await runCommand( mockSitePath, {
				name: 'My Site',
				wpVersion: 'latest',
				phpVersion: '8.0',
				blueprintJson: testBlueprint,
				enableHttps: false,
				noStart: false,
			} );

			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( {
					blueprint: expect.objectContaining( {
						steps: expect.arrayContaining( [
							expect.objectContaining( {
								step: 'setSiteOptions',
								options: { blogname: 'My Site' },
							} ),
						] ),
					} ),
				} )
			);
		} );

		it( 'should warn about unsupported blueprint features', async () => {
			( validateBlueprintData as jest.Mock ).mockReturnValue( {
				valid: true,
				warnings: [
					{
						type: 'step',
						name: 'login',
						reason: 'Studio automatically creates and logs in the admin user',
					},
				],
			} );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				blueprintJson: testBlueprint,
				enableHttps: false,
				noStart: false,
			} );
		} );
	} );

	describe( 'noStart Option', () => {
		it( 'should not start server when noStart is true', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: true,
			} );

			expect( connect ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( setupCustomDomain ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site created successfully!' );
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio site start" to start the site.' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should apply blueprint without starting server when noStart is true', async () => {
			const testBlueprint: BlueprintV1Declaration = { steps: [] };

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				blueprintJson: testBlueprint,
				enableHttps: false,
				noStart: true,
			} );

			expect( connect ).toHaveBeenCalled();
			expect( runBlueprint ).toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio site start" to start the site.' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Error Handling', () => {
		it( 'should handle WordPress server start failure', async () => {
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow( 'Failed to start WordPress server' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle blueprint application failure', async () => {
			const testBlueprint: BlueprintV1Declaration = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					blueprintJson: testBlueprint,
					enableHttps: false,
					noStart: true,
				} )
			).rejects.toThrow( 'Failed to apply blueprint' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle SQLite setup failure', async () => {
			( installSqliteIntegration as jest.Mock ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect(
				runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} )
			).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from PM2 even on error', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Appdata error' ) );

			try {
				await runCommand( mockSitePath, {
					wpVersion: 'latest',
					phpVersion: '8.0',
					enableHttps: false,
					noStart: false,
				} );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 on success', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should unlock appdata after saving', async () => {
			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( unlockAppdata ).toHaveBeenCalled();
		} );
	} );
} );
