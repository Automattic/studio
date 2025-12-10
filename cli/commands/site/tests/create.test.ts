import { Blueprint } from '@wp-playground/blueprints';
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
import { Logger } from 'cli/logger';

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

			const { runCommand } = await import( '../create' );

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

		it( 'should error if site path is already in use', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockExistingSite ],
				snapshots: [],
			} );
			( arePathsEqual as jest.Mock ).mockReturnValue( true );

			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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
				expect.any( Logger ),
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
			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site with custom domain', async () => {
			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( mockExistingSite.port );
		} );

		it( 'should set isWpAutoUpdating true for latest WordPress version', async () => {
			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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
		const testBlueprint: Blueprint = {
			steps: [ { step: 'installPlugin', pluginData: { slug: 'akismet' } } ],
		};

		it( 'should apply blueprint when provided', async () => {
			const { runCommand } = await import( '../create' );

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
				expect.any( Logger ),
				expect.objectContaining( {
					blueprint: expect.any( Object ),
				} )
			);
		} );

		it( 'should prepend setSiteOptions step when name is provided with blueprint', async () => {
			const { runCommand } = await import( '../create' );

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
				expect.any( Logger ),
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

			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

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
			const testBlueprint: Blueprint = { steps: [] };

			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );
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
			const testBlueprint: Blueprint = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			const { runCommand } = await import( '../create' );
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

			const { runCommand } = await import( '../create' );

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

			const { runCommand } = await import( '../create' );

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
			const { runCommand } = await import( '../create' );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should unlock appdata after saving', async () => {
			const { runCommand } = await import( '../create' );

			await runCommand( mockSitePath, {
				wpVersion: 'latest',
				phpVersion: '8.0',
				enableHttps: false,
				noStart: false,
			} );

			expect( unlockAppdata ).toHaveBeenCalled();
		} );
	} );

	describe( 'coerceWpVersion', () => {
		it( 'should error if WordPress version is invalid', async () => {
			const { coerceWpVersion } = await import( '../create' );

			expect( () => coerceWpVersion( 'invalid-version' ) ).toThrow( 'Invalid value' );
		} );

		it( 'should error if WordPress version is below minimum', async () => {
			const { coerceWpVersion } = await import( '../create' );

			expect( () => coerceWpVersion( '6.0' ) ).toThrow( 'Invalid value' );
		} );
	} );

	describe( 'coerceBlueprint', () => {
		const testBlueprint = { steps: [ { step: 'login' } ] };

		beforeEach( () => {
			jest.clearAllMocks();
		} );

		it( 'should throw error if blueprint file not found', async () => {
			const fs = require( 'fs' );
			jest.spyOn( fs, 'existsSync' ).mockReturnValue( false );

			const { coerceBlueprint } = await import( '../create' );

			await expect( coerceBlueprint( '/path/to/missing.json' ) ).rejects.toThrow(
				'Blueprint file not found'
			);
		} );

		it( 'should throw error if blueprint file contains invalid JSON', async () => {
			const fs = require( 'fs' );
			jest.spyOn( fs, 'existsSync' ).mockReturnValue( true );
			jest.spyOn( fs, 'readFileSync' ).mockReturnValue( 'not valid json' );

			const { coerceBlueprint } = await import( '../create' );

			await expect( coerceBlueprint( '/path/to/invalid.json' ) ).rejects.toThrow(
				'Failed to parse blueprint JSON file'
			);
		} );

		it( 'should read and parse blueprint from local file', async () => {
			const fs = require( 'fs' );
			jest.spyOn( fs, 'existsSync' ).mockReturnValue( true );
			jest.spyOn( fs, 'readFileSync' ).mockReturnValue( JSON.stringify( testBlueprint ) );

			const { coerceBlueprint } = await import( '../create' );

			const result = await coerceBlueprint( '/path/to/blueprint.json' );

			expect( result ).toEqual( testBlueprint );
			expect( fs.existsSync ).toHaveBeenCalled();
			expect( fs.readFileSync ).toHaveBeenCalled();
		} );

		it( 'should throw error if fetch fails', async () => {
			global.fetch = jest.fn().mockResolvedValue( {
				ok: false,
			} );

			const { coerceBlueprint } = await import( '../create' );

			await expect( coerceBlueprint( 'https://example.com/blueprint.json' ) ).rejects.toThrow(
				'Failed to fetch blueprint'
			);
		} );

		it( 'should throw error if fetched content is not valid JSON', async () => {
			global.fetch = jest.fn().mockResolvedValue( {
				ok: true,
				json: jest.fn().mockRejectedValue( new Error( 'Invalid JSON' ) ),
			} );

			const { coerceBlueprint } = await import( '../create' );

			await expect( coerceBlueprint( 'https://example.com/blueprint.json' ) ).rejects.toThrow(
				'Failed to parse blueprint JSON'
			);
		} );

		it( 'should fetch and parse blueprint from URL', async () => {
			global.fetch = jest.fn().mockResolvedValue( {
				ok: true,
				json: jest.fn().mockResolvedValue( testBlueprint ),
			} );

			const { coerceBlueprint } = await import( '../create' );

			const result = await coerceBlueprint( 'https://example.com/blueprint.json' );

			expect( result ).toEqual( testBlueprint );
			expect( global.fetch ).toHaveBeenCalledWith( 'https://example.com/blueprint.json' );
		} );
	} );
} );
