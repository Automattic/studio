import { Blueprint, StepDefinition } from '@wp-playground/blueprints';
import {
	filterUnsupportedBlueprintFeatures,
	validateBlueprintData,
} from 'common/lib/blueprint-validation';
import {
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	arePathsEqual,
	recursiveCopyDirectory,
} from 'common/lib/fs-utils';
import { isOnline } from 'common/lib/network-utils';
import { portFinder } from 'common/lib/port-finder';
import {
	lockAppdata,
	readAppdata,
	removeSiteFromAppdata,
	saveAppdata,
	unlockAppdata,
	updateSiteAutoStart,
	SiteData,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { runCommand } from '../create';

jest.mock( 'common/lib/fs-utils' );
jest.mock( 'common/lib/network-utils' );
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
	updateSiteLatestCliPid: jest.fn(),
	updateSiteAutoStart: jest.fn().mockResolvedValue( undefined ),
	removeSiteFromAppdata: jest.fn(),
	getSiteUrl: jest.fn( ( site ) => `http://localhost:${ site.port }` ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/server-files', () => ( {
	getServerFilesPath: jest.fn().mockReturnValue( '/test/server-files' ),
} ) );
jest.mock( 'cli/lib/site-language' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/sqlite-integration' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site create', () => {
	const mockSitePath = '/test/site/new-site';
	const mockPort = 8881;

	const defaultTestOptions = {
		wpVersion: 'latest',
		phpVersion: '8.0' as const,
		enableHttps: false,
		noStart: false,
		skipBrowser: false,
		skipLogDetails: false,
	};

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
	let loggerReportSuccessSpy: jest.SpyInstance;
	let loggerReportWarningSpy: jest.SpyInstance;

	const createPathExistsMock = ( sitePathExists = false ) => {
		const bundledWPPath = require( 'path' ).join(
			'/test/server-files',
			'wordpress-versions',
			'latest'
		);
		const mock = jest.fn().mockImplementation( ( path: string ) => {
			if ( path === bundledWPPath ) {
				return Promise.resolve( true );
			}
			if ( path === mockSitePath ) {
				return Promise.resolve( sitePathExists );
			}
			return Promise.resolve( false );
		} );
		( pathExists as jest.Mock ).mockImplementation( mock );
	};

	beforeEach( () => {
		jest.clearAllMocks();

		consoleLogSpy = jest.spyOn( console, 'log' ).mockImplementation();
		fsMkdirSyncSpy = jest.spyOn( require( 'fs' ), 'mkdirSync' ).mockReturnValue( undefined );
		loggerReportSuccessSpy = jest.spyOn( Logger.prototype, 'reportSuccess' );
		loggerReportWarningSpy = jest.spyOn( Logger.prototype, 'reportWarning' );
		createPathExistsMock( false );
		( isEmptyDir as jest.Mock ).mockResolvedValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( false );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a, b ) => a === b );
		( recursiveCopyDirectory as jest.Mock ).mockResolvedValue( undefined );
		( portFinder.getOpenPort as jest.Mock ).mockResolvedValue( mockPort );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ ...mockAppdata.sites ],
			snapshots: [ ...mockAppdata.snapshots ],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( keepSqliteIntegrationUpdated as jest.Mock ).mockResolvedValue( true );
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
		( isOnline as jest.Mock ).mockResolvedValue( true );
		( getPreferredSiteLanguage as jest.Mock ).mockResolvedValue( 'en' );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Validation Errors', () => {
		it( 'should error if directory exists and is not empty nor a WordPress site', async () => {
			( pathExists as jest.Mock ).mockResolvedValue( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( false );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'The selected directory is not empty nor an existing WordPress site.'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if site path is already in use', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockExistingSite ],
				snapshots: [],
			} );
			( arePathsEqual as jest.Mock ).mockReturnValue( true );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'The selected directory is already in use.'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if custom domain is invalid', async () => {
			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					customDomain: 'invalid-domain-without-tld',
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
					...defaultTestOptions,
					customDomain: 'mysite.local',
				} )
			).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if Blueprint validation fails', async () => {
			( validateBlueprintData as jest.Mock ).mockResolvedValue( {
				valid: false,
				error: 'Invalid Blueprint',
			} );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: {},
					},
				} )
			).rejects.toThrow( 'Invalid Blueprint' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if SQLite integration is not available', async () => {
			( keepSqliteIntegrationUpdated as jest.Mock ).mockRejectedValue(
				new Error( 'SQLite integration files not found. Please ensure Studio is installed.' )
			);

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'SQLite integration files not found'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should create a basic site successfully', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsMkdirSyncSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true } );
			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'SQLite integration configured' );
			expect( portFinder.getOpenPort ).toHaveBeenCalled();
			expect( lockAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			expect( connect ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( updateSiteAutoStart ).toHaveBeenCalledWith( expect.any( String ), true );
			expect( logSiteDetails ).toHaveBeenCalled();
			expect( openSiteInBrowser ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip SQLite integration when it is already configured', async () => {
			( keepSqliteIntegrationUpdated as jest.Mock ).mockResolvedValue( false );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'SQLite integration skipped' );
		} );

		it( 'should create site with custom name', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Custom Site',
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
			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'Site name set to: My Custom Site' );
			expect( loggerReportWarningSpy ).not.toHaveBeenCalled();
		} );

		it( 'should NOT override blogname when adding existing WordPress directory with wp-config.php and name', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			const bundledWPPath = require( 'path' ).join(
				'/test/server-files',
				'wordpress-versions',
				'latest'
			);
			( pathExists as jest.Mock ).mockImplementation( ( path: string ) => {
				if ( path === bundledWPPath ) {
					return Promise.resolve( true );
				}
				if ( path === wpConfigPath ) {
					return Promise.resolve( true );
				}
				if ( path === mockSitePath ) {
					return Promise.resolve( true );
				}
				return Promise.resolve( false );
			} );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Custom Site',
			} );

			// Verify setSiteOptions step is NOT in the blueprint steps
			const calls = ( startWordPressServer as jest.Mock ).mock.calls;
			const blueprintCall = calls.find(
				( call ) =>
					call[ 2 ]?.blueprint?.steps?.some(
						( step: StepDefinition ) => step.step === 'setSiteOptions'
					)
			);
			expect( blueprintCall ).toBeUndefined();

			expect( loggerReportWarningSpy ).toHaveBeenCalledWith(
				'Site name ignored because the directory contains a WordPress site.'
			);
		} );

		it( 'should set blogname when WordPress directory exists but has no wp-config.php', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			const bundledWPPath = require( 'path' ).join(
				'/test/server-files',
				'wordpress-versions',
				'latest'
			);
			( pathExists as jest.Mock ).mockImplementation( ( path: string ) => {
				if ( path === bundledWPPath ) {
					return Promise.resolve( true );
				}
				if ( path === wpConfigPath ) {
					return Promise.resolve( false );
				}
				if ( path === mockSitePath ) {
					return Promise.resolve( true );
				}
				return Promise.resolve( false );
			} );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Custom Site',
			} );

			// Verify setSiteOptions step IS in the blueprint steps (because wp-config.php doesn't exist)
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

			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'Site name set to: My Custom Site' );
			expect( loggerReportWarningSpy ).not.toHaveBeenCalled();
		} );

		it( 'should use folder name as site name if no name provided', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

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

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site in existing WordPress directory', async () => {
			( pathExists as jest.Mock ).mockResolvedValue( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site with custom domain', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				customDomain: 'mysite.local',
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
				...defaultTestOptions,
				customDomain: 'mysite.local',
				enableHttps: true,
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

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( mockExistingSite.port );
		} );

		it( 'should set isWpAutoUpdating true for latest WordPress version', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

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
				...defaultTestOptions,
				wpVersion: '6.4',
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

		it( 'should apply Blueprint when provided', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: testBlueprint,
				},
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

		it( 'should prepend setSiteOptions step when name is provided with Blueprint', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Site',
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: testBlueprint,
				},
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
			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'Site name set to: My Site' );
		} );

		it( 'should warn about unsupported Blueprint features', async () => {
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
				...defaultTestOptions,
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: testBlueprint,
				},
			} );
		} );
	} );

	describe( 'noStart Option', () => {
		it( 'should not start server when noStart is true', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				noStart: true,
			} );

			expect( connect ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( setupCustomDomain ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site created successfully' );
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio site start" to start the site.' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should apply Blueprint without starting server when noStart is true', async () => {
			const testBlueprint: Blueprint = { steps: [] };

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: testBlueprint,
				},
				noStart: true,
			} );

			expect( connect ).toHaveBeenCalled();
			expect( runBlueprint ).toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio site start" to start the site.' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should run Blueprint when preferred language is configured but no Blueprint was given', async () => {
			( getPreferredSiteLanguage as jest.Mock ).mockResolvedValue( 'es_ES' );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				noStart: true,
			} );

			expect( connect ).toHaveBeenCalled();
			expect( runBlueprint ).toHaveBeenCalledWith(
				expect.any( Object ),
				expect.any( Object ),
				expect.objectContaining( {
					blueprint: expect.any( Object ),
					blueprintUri: expect.any( String ),
				} )
			);
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site created successfully' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Error Handling', () => {
		it( 'should handle WordPress server start failure', async () => {
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle Blueprint application failure', async () => {
			const testBlueprint: Blueprint = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: testBlueprint,
					},
					noStart: true,
				} )
			).rejects.toThrow( 'Failed to apply Blueprint' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle SQLite setup failure', async () => {
			( keepSqliteIntegrationUpdated as jest.Mock ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from PM2 even on error', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Appdata error' ) );

			try {
				await runCommand( mockSitePath, { ...defaultTestOptions } );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 on success', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should unlock appdata after saving', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( unlockAppdata ).toHaveBeenCalled();
		} );

		it( 'should remove site from appdata when server start fails', async () => {
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( removeSiteFromAppdata ).toHaveBeenCalled();
		} );

		it( 'should remove site from appdata when Blueprint application fails', async () => {
			const testBlueprint = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: testBlueprint,
					},
					noStart: true,
				} )
			).rejects.toThrow();

			expect( removeSiteFromAppdata ).toHaveBeenCalled();
		} );

		it( 'should delete site directory when server start fails for new directory', async () => {
			createPathExistsMock( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( false );
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			const fsRmSpy = jest.spyOn( require( 'fs' ).promises, 'rm' ).mockResolvedValue( undefined );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( fsRmSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true, force: true } );
		} );

		it( 'should NOT delete site directory when server start fails for existing WordPress directory', async () => {
			createPathExistsMock( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			const fsRmSpy = jest.spyOn( require( 'fs' ).promises, 'rm' ).mockResolvedValue( undefined );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( fsRmSpy ).not.toHaveBeenCalled();
		} );

		it( 'should delete site directory when Blueprint application fails for new directory', async () => {
			createPathExistsMock( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( false );
			const testBlueprint = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			const fsRmSpy = jest.spyOn( require( 'fs' ).promises, 'rm' ).mockResolvedValue( undefined );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: testBlueprint,
					},
					noStart: true,
				} )
			).rejects.toThrow();

			expect( fsRmSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true, force: true } );
		} );

		it( 'should NOT delete site directory when Blueprint application fails for existing WordPress directory', async () => {
			createPathExistsMock( true );
			( isEmptyDir as jest.Mock ).mockResolvedValue( false );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
			const testBlueprint = { steps: [] };
			( runBlueprint as jest.Mock ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			const fsRmSpy = jest.spyOn( require( 'fs' ).promises, 'rm' ).mockResolvedValue( undefined );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: testBlueprint,
					},
					noStart: true,
				} )
			).rejects.toThrow();

			expect( fsRmSpy ).not.toHaveBeenCalled();
		} );
	} );
} );
