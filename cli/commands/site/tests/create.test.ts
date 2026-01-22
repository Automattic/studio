import fs from 'fs';
import { Blueprint, StepDefinition } from '@wp-playground/blueprints';
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
import { getServerFilesPath } from 'cli/lib/server-files';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
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
import { vi, type MockInstance } from 'vitest';
import { runCommand } from '../create';

vi.mock( 'common/lib/fs-utils' );
vi.mock( 'common/lib/network-utils' );
vi.mock( 'common/lib/port-finder', () => ( {
	portFinder: {
		addUnavailablePort: vi.fn(),
		getOpenPort: vi.fn(),
	},
} ) );
vi.mock( 'common/lib/passwords', () => ( {
	createPassword: vi.fn().mockReturnValue( 'generated-password-123' ),
} ) );
vi.mock( 'common/lib/blueprint-validation' );
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		readAppdata: vi.fn(),
		saveAppdata: vi.fn(),
		lockAppdata: vi.fn(),
		unlockAppdata: vi.fn(),
		updateSiteLatestCliPid: vi.fn(),
		updateSiteAutoStart: vi.fn().mockResolvedValue( undefined ),
		removeSiteFromAppdata: vi.fn(),
		getSiteUrl: vi.fn( ( site ) => `http://localhost:${ site.port }` ),
	};
} );
vi.mock( 'cli/lib/pm2-manager' );
vi.mock( 'cli/lib/server-files', () => ( {
	getServerFilesPath: vi.fn( () => '/test/server-files' ),
} ) );
vi.mock( 'cli/lib/site-language' );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/wordpress-server-manager' );

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

	let consoleLogSpy: MockInstance;
	let fsMkdirSyncSpy: MockInstance;
	let loggerReportSuccessSpy: MockInstance;

	const createPathExistsMock = ( sitePathExists = false ) => {
		const path = require( 'path' );
		const bundledWPPath = path.join( '/test/server-files', 'wordpress-versions', 'latest' );
		const mock = vi.fn().mockImplementation( ( checkPath: string ) => {
			if ( checkPath === bundledWPPath ) {
				return Promise.resolve( true );
			}
			if ( checkPath === mockSitePath ) {
				return Promise.resolve( sitePathExists );
			}
			return Promise.resolve( false );
		} );
		vi.mocked( pathExists ).mockImplementation( mock );
	};

	beforeEach( () => {
		vi.clearAllMocks();

		consoleLogSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );
		fsMkdirSyncSpy = vi.spyOn( fs, 'mkdirSync' ).mockReturnValue( undefined );
		loggerReportSuccessSpy = vi.spyOn( Logger.prototype, 'reportSuccess' );
		vi.mocked( getServerFilesPath ).mockReturnValue( '/test/server-files' );
		createPathExistsMock( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
		vi.mocked( isWordPressDirectory ).mockReturnValue( false );
		vi.mocked( arePathsEqual ).mockImplementation( ( a, b ) => a === b );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( portFinder.getOpenPort ).mockResolvedValue( mockPort );
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
			sites: [ ...mockAppdata.sites ],
			snapshots: [ ...mockAppdata.snapshots ],
		} );
		vi.mocked( saveAppdata ).mockResolvedValue( undefined );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( true );
		vi.mocked( connect ).mockResolvedValue( undefined );
		vi.mocked( disconnect ).mockResolvedValue( undefined );
		vi.mocked( setupCustomDomain ).mockResolvedValue( undefined );
		vi.mocked( startWordPressServer ).mockResolvedValue( mockProcessDescription );
		vi.mocked( runBlueprint ).mockResolvedValue( undefined );
		vi.mocked( logSiteDetails ).mockImplementation( () => {} );
		vi.mocked( openSiteInBrowser ).mockResolvedValue( undefined );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true, warnings: [] } );
		vi.mocked( filterUnsupportedBlueprintFeatures ).mockImplementation(
			( blueprint ) => blueprint
		);
		vi.mocked( isOnline ).mockResolvedValue( true );
		vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Validation Errors', () => {
		it( 'should error if directory exists and is not empty nor a WordPress site', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( false );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'The selected directory is not empty nor an existing WordPress site.'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should error if site path is already in use', async () => {
			vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
				sites: [ mockExistingSite ],
				snapshots: [],
			} );
			vi.mocked( arePathsEqual ).mockReturnValue( true );

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
			vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
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
			vi.mocked( validateBlueprintData ).mockResolvedValue( {
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
			vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue(
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
			vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( false );

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
		} );

		it( 'should NOT override blogname when adding existing WordPress directory with wp-config.php and name', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			const bundledWPPath = require( 'path' ).join(
				'/test/server-files',
				'wordpress-versions',
				'latest'
			);
			vi.mocked( pathExists ).mockImplementation(
				async ( path: string ) =>
					path === bundledWPPath || path === wpConfigPath || path === mockSitePath
			);
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Custom Site',
			} );

			// Verify setSiteOptions step is NOT in the blueprint steps
			const calls = vi.mocked( startWordPressServer ).mock.calls;
			const blueprintCall = calls.find(
				( call ) =>
					call[ 2 ]?.blueprint?.steps?.some(
						( step: StepDefinition ) => step.step === 'setSiteOptions'
					)
			);
			expect( blueprintCall ).toBeUndefined();
		} );

		it( 'should set blogname when WordPress directory exists but has no wp-config.php', async () => {
			const bundledWPPath = require( 'path' ).join(
				'/test/server-files',
				'wordpress-versions',
				'latest'
			);
			vi.mocked( pathExists ).mockImplementation(
				async ( path: string ) => path === bundledWPPath || path === mockSitePath
			);
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );

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
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( true );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsMkdirSyncSpy ).not.toHaveBeenCalled();
		} );

		it( 'should create site in existing WordPress directory', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );

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
			vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
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
		} );

		it( 'should warn about unsupported Blueprint features', async () => {
			vi.mocked( validateBlueprintData ).mockResolvedValue( {
				valid: true,
				warnings: [
					{
						feature: 'login',
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
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'es_ES' );

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
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle Blueprint application failure', async () => {
			const testBlueprint: Blueprint = { steps: [] };
			vi.mocked( runBlueprint ).mockRejectedValue( new Error( 'Blueprint failed' ) );

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
			vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from PM2 even on error', async () => {
			vi.mocked( readAppdata ).mockRejectedValue( new Error( 'Appdata error' ) );

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
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( removeSiteFromAppdata ).toHaveBeenCalled();
		} );

		it( 'should remove site from appdata when Blueprint application fails', async () => {
			const testBlueprint = { steps: [] };
			vi.mocked( runBlueprint ).mockRejectedValue( new Error( 'Blueprint failed' ) );

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
			vi.mocked( isWordPressDirectory ).mockReturnValue( false );
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			const fsRmSpy = vi.spyOn( fs.promises, 'rm' ).mockResolvedValue( undefined );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( fsRmSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true, force: true } );
		} );

		it( 'should NOT delete site directory when server start fails for existing WordPress directory', async () => {
			createPathExistsMock( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			const fsRmSpy = vi.spyOn( fs.promises, 'rm' ).mockResolvedValue( undefined );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( fsRmSpy ).not.toHaveBeenCalled();
		} );

		it( 'should delete site directory when Blueprint application fails for new directory', async () => {
			createPathExistsMock( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( false );
			const testBlueprint = { steps: [] };
			vi.mocked( runBlueprint ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			const fsRmSpy = vi.spyOn( fs.promises, 'rm' ).mockResolvedValue( undefined );

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
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );
			const testBlueprint = { steps: [] };
			vi.mocked( runBlueprint ).mockRejectedValue( new Error( 'Blueprint failed' ) );

			const fsRmSpy = vi.spyOn( fs.promises, 'rm' ).mockResolvedValue( undefined );

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
