import fs from 'fs';
import path from 'path';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import {
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	arePathsEqual,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { isOnline } from '@studio/common/lib/network-utils';
import { portFinder } from '@studio/common/lib/port-finder';
import { normalizeLineEndings } from '@studio/common/lib/remove-default-db-constants';
import {
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { type SupportedPHPVersion } from '@studio/common/types/php-versions';
import { Blueprint, BlueprintV1Declaration } from '@wp-playground/blueprints';
import { vi, type MockInstance } from 'vitest';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	SiteData,
} from 'cli/lib/cli-config/core';
import { removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { runCommand } from '../create';

vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( '@studio/common/lib/network-utils' );
vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		addUnavailablePort: vi.fn(),
		getOpenPort: vi.fn(),
	},
} ) );
vi.mock( '@studio/common/lib/passwords', () => ( {
	createPassword: vi.fn().mockReturnValue( 'generated-password-123' ),
} ) );
vi.mock( '@studio/common/lib/blueprint-validation' );
vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn(),
		lockCliConfig: vi.fn(),
		unlockCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		updateSiteLatestCliPid: vi.fn(),
		removeSiteFromConfig: vi.fn(),
		getSiteUrl: vi.fn().mockImplementation( ( site ) => `http://localhost:${ site.port }` ),
	};
} );
vi.mock( 'cli/lib/language-packs' );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/dependency-management/setup' );
vi.mock( 'cli/lib/dependency-management/wordpress' );
vi.mock( 'cli/lib/dependency-management/lock', () => ( {
	withWordPressVersionsLock: vi.fn( ( run: () => Promise< unknown > ) => run() ),
} ) );
vi.mock( import( '@studio/common/lib/well-known-paths' ), async ( importOriginal ) => {
	const actual = await importOriginal();
	return {
		...actual,
		getServerFilesPath: vi.fn().mockReturnValue( '/test/server-files' ),
	};
} );
vi.mock( 'cli/lib/site-language' );
vi.mock( 'cli/lib/site-utils' );
vi.mock( '@studio/common/lib/agent-skills' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/get-wordpress-version' );

describe( 'CLI: studio site create', () => {
	const mockSitePath = '/test/site/new-site';
	const mockPort = 8881;

	const defaultTestOptions = {
		wpVersion: 'latest',
		phpVersion: '8.3' as const,
		runtime: SITE_RUNTIME_PLAYGROUND as SiteRuntime,
		fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY as SiteFileAccess,
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

	const mockProcessDescription: ProcessDescription = {
		name: 'test-uuid-1234',
		pmId: 0,
		status: 'online',
		pid: 12345,
		runtime: SITE_RUNTIME_PLAYGROUND,
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
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [ ...mockAppdata.sites ],
		} );
		vi.mocked( saveCliConfig ).mockResolvedValue( undefined );
		vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( updateServerFiles ).mockResolvedValue( true );
		vi.mocked( downloadWordPress ).mockResolvedValue( undefined );
		vi.mocked( setupCustomDomain ).mockResolvedValue( undefined );
		vi.mocked( startWordPressServer ).mockResolvedValue( mockProcessDescription );
		vi.mocked( runBlueprint ).mockResolvedValue( undefined );
		vi.mocked( logSiteDetails ).mockImplementation( () => {} );
		vi.mocked( openSiteInBrowser ).mockResolvedValue( undefined );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );
		vi.mocked( isOnline ).mockResolvedValue( true );
		vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );
		vi.mocked( copyLanguagePackToSite ).mockResolvedValue( false );
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.5' );
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
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

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should error if site path is already in use', async () => {
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ mockExistingSite ],
			} );
			vi.mocked( arePathsEqual ).mockReturnValue( true );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'The selected directory is already in use.'
			);

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should error if custom domain is invalid', async () => {
			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					customDomain: 'invalid-domain-without-tld',
				} )
			).rejects.toThrow();

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should error if custom domain is already in use', async () => {
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ { ...mockExistingSite, customDomain: 'mysite.local' } ],
			} );

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					customDomain: 'mysite.local',
				} )
			).rejects.toThrow();

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should error if PHP version is not supported', async () => {
			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					phpVersion: '8.1' as SupportedPHPVersion,
				} )
			).rejects.toThrow( 'PHP 8.1 is not supported. Supported versions: 8.5, 8.4, 8.3, 8.2.' );

			expect( saveCliConfig ).not.toHaveBeenCalled();
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

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should error if SQLite integration is not available', async () => {
			vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue(
				new Error( 'SQLite integration files not found. Please ensure Studio is installed.' )
			);

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'SQLite integration files not found'
			);

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should create a basic site successfully', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsMkdirSyncSpy ).toHaveBeenCalledWith( mockSitePath, { recursive: true } );
			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
			expect( loggerReportSuccessSpy ).toHaveBeenCalledWith( 'SQLite integration configured' );
			expect( portFinder.getOpenPort ).toHaveBeenCalled();
			expect( lockCliConfig ).toHaveBeenCalled();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( connectToDaemon ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalled();
			expect( openSiteInBrowser ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should persist the runtime and file access on the created site', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				runtime: SITE_RUNTIME_NATIVE_PHP,
				phpVersion: '8.4',
				fileAccess: 'all-files',
			} );

			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							runtime: SITE_RUNTIME_NATIVE_PHP,
							fileAccess: 'all-files',
						} ),
					] ),
				} )
			);
		} );

		it( 'should reject "all-files" file access for sandbox sites', async () => {
			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					fileAccess: 'all-files',
				} )
			).rejects.toThrow( 'File access "all-files" requires the native PHP runtime.' );

			expect( saveCliConfig ).not.toHaveBeenCalled();
		} );

		it( 'should create site with custom name', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Custom Site',
			} );

			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							name: 'My Custom Site',
						} ),
					] ),
				} )
			);
			// blogname is now set by playground-server-child via buildSetupSteps, not create.ts
			expect( startWordPressServer ).toHaveBeenCalled();
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
					( call[ 2 ] as { blueprint?: BlueprintV1Declaration } )?.blueprint?.steps?.some(
						( step ) => typeof step === 'object' && step?.step === 'setSiteOptions'
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

			// blogname is now set by playground-server-child via buildSetupSteps, not create.ts
			expect( startWordPressServer ).toHaveBeenCalled();
		} );

		it( 'should use folder name as site name if no name provided', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( saveCliConfig ).toHaveBeenCalledWith(
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

			expect( saveCliConfig ).toHaveBeenCalledWith(
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

			expect( saveCliConfig ).toHaveBeenCalledWith(
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
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ mockExistingSite ],
			} );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( mockExistingSite.port );
		} );

		it( 'should set isWpAutoUpdating true for latest WordPress version', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( saveCliConfig ).toHaveBeenCalledWith(
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

			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							isWpAutoUpdating: false,
						} ),
					] ),
				} )
			);
		} );

		it( 'should not copy specific WordPress versions for Playground runtime', async () => {
			vi.mocked( recursiveCopyDirectory ).mockClear();

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				wpVersion: '6.4',
			} );

			expect( downloadWordPress ).not.toHaveBeenCalled();
			expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		} );

		it( 'should download and copy specific WordPress versions for native PHP runtime', async () => {
			vi.mocked( recursiveCopyDirectory ).mockClear();

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				runtime: SITE_RUNTIME_NATIVE_PHP,
				phpVersion: '8.3',
				wpVersion: '6.4',
			} );

			expect( downloadWordPress ).toHaveBeenCalledWith( '6.4' );
			expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
				path.join( path.sep, 'test', 'server-files', 'wordpress-versions', '6.4' ),
				mockSitePath
			);
		} );
	} );

	describe( 'Blueprint Handling', () => {
		const testBlueprint: Blueprint = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
			],
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

		it( 'should pass Blueprint through when name is provided with Blueprint', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				name: 'My Site',
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: testBlueprint,
				},
			} );

			// blogname is now set by playground-server-child via buildSetupSteps, not prepended here
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.any( Logger ),
				expect.objectContaining( {
					blueprint: expect.any( Object ),
				} )
			);
		} );
	} );

	describe( 'Multisite Validation', () => {
		it( 'should error when enableMultisite step is present without custom domain', async () => {
			const multisiteBlueprint: Blueprint = {
				steps: [ { step: 'enableMultisite' } ],
			};

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint: {
						uri: '/home/test/blueprint.json',
						contents: multisiteBlueprint,
					},
				} )
			).rejects.toThrow( /enableMultisite.*custom domain/i );
		} );

		it( 'should proceed when enableMultisite step is present with custom domain', async () => {
			const multisiteBlueprint: Blueprint = {
				steps: [ { step: 'enableMultisite' } ],
			};

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				customDomain: 'test.local',
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: multisiteBlueprint,
				},
			} );

			expect( startWordPressServer ).toHaveBeenCalled();
		} );
	} );

	describe( 'noStart Option', () => {
		it( 'should not start server when noStart is true', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				noStart: true,
			} );

			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( setupCustomDomain ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site created successfully' );
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio start" to start the site.' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
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

			expect( connectToDaemon ).toHaveBeenCalled();
			expect( runBlueprint ).toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Run "studio start" to start the site.' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should create site with siteLanguage when preferred language is configured but no Blueprint given', async () => {
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'es_ES' );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				noStart: true,
			} );

			// No blueprint to run — language steps are applied by playground-server-child on first start
			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( runBlueprint ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site created successfully' );
		} );
	} );

	describe( 'Language Packs', () => {
		it( 'should use bundled language packs and pass siteLanguage for latest WP version', async () => {
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'sv_SE' );
			vi.mocked( copyLanguagePackToSite ).mockResolvedValue( true );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( copyLanguagePackToSite ).toHaveBeenCalledWith( mockSitePath, 'sv_SE' );
			// Language steps (defineWpConfigConsts / setSiteLanguage) are now built by
			// playground-server-child's buildSetupSteps, not by create.ts
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.any( Logger ),
				expect.objectContaining( { siteLanguage: 'sv_SE' } )
			);
		} );

		it( 'should fall back to setSiteLanguage when bundled packs are not available', async () => {
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'sv_SE' );
			vi.mocked( copyLanguagePackToSite ).mockResolvedValue( false );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			// setSiteLanguage vs defineWpConfigConsts is now decided by playground-server-child
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.any( Logger ),
				expect.objectContaining( { siteLanguage: 'sv_SE' } )
			);
		} );

		it( 'should pass siteLanguage for non-latest WP versions', async () => {
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'sv_SE' );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				wpVersion: '6.5',
			} );

			expect( copyLanguagePackToSite ).not.toHaveBeenCalled();
			// setSiteLanguage step is now built by playground-server-child, not create.ts
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.anything(),
				expect.any( Logger ),
				expect.objectContaining( { siteLanguage: 'sv_SE' } )
			);
		} );

		it( 'should not set language when locale is English', async () => {
			vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( copyLanguagePackToSite ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Error Handling', () => {
		it( 'should handle WordPress server start failure', async () => {
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);

			expect( disconnectFromDaemon ).toHaveBeenCalled();
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

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should handle SQLite setup failure', async () => {
			vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from process manager even on error', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'Appdata error' ) );

			try {
				await runCommand( mockSitePath, { ...defaultTestOptions } );
			} catch {
				// Expected
			}

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should disconnect from process manager on success', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should unlock appdata after saving', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( unlockCliConfig ).toHaveBeenCalled();
		} );

		it( 'should remove site from appdata when server start fails', async () => {
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( removeSiteFromConfig ).toHaveBeenCalled();
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

			expect( removeSiteFromConfig ).toHaveBeenCalled();
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

	describe( 'DB Constants Removal', () => {
		const wpConfigWithDbBlock = normalizeLineEndings(
			`<?php
// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'database_name_here' );

/** Database username */
define( 'DB_USER', 'username_here' );

/** Database password */
define( 'DB_PASSWORD', 'password_here' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );

$table_prefix = 'wp_';
`
		);

		const wpConfigWithoutDbBlock = normalizeLineEndings(
			`<?php
/**
 * Database connection information is automatically provided.
 */
$table_prefix = 'wp_';
`
		);

		it( 'should strip default DB constants from wp-config.php after server start', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			const fsExistsSyncSpy = vi
				.spyOn( fs, 'existsSync' )
				.mockImplementation( ( p ) => p === wpConfigPath );
			const fsReadFileSyncSpy = vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( p ) => {
				if ( p === wpConfigPath ) {
					return wpConfigWithDbBlock;
				}
				return '';
			} );
			const fsWriteFileSyncSpy = vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsExistsSyncSpy ).toHaveBeenCalledWith( wpConfigPath );
			expect( fsReadFileSyncSpy ).toHaveBeenCalledWith( wpConfigPath, 'utf-8' );
			expect( fsWriteFileSyncSpy ).toHaveBeenCalledWith(
				wpConfigPath,
				expect.not.stringContaining( "define( 'DB_NAME'" ),
				'utf-8'
			);
		} );

		it( 'should strip default DB constants from wp-config.php after Blueprint application (noStart)', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			const fsExistsSyncSpy = vi
				.spyOn( fs, 'existsSync' )
				.mockImplementation( ( p ) => p === wpConfigPath );
			const fsReadFileSyncSpy = vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( p ) => {
				if ( p === wpConfigPath ) {
					return wpConfigWithDbBlock;
				}
				return '';
			} );
			const fsWriteFileSyncSpy = vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				noStart: true,
				blueprint: {
					uri: '/home/test/blueprint.json',
					contents: { steps: [] },
				},
			} );

			expect( fsExistsSyncSpy ).toHaveBeenCalledWith( wpConfigPath );
			expect( fsReadFileSyncSpy ).toHaveBeenCalledWith( wpConfigPath, 'utf-8' );
			expect( fsWriteFileSyncSpy ).toHaveBeenCalledWith(
				wpConfigPath,
				expect.not.stringContaining( "define( 'DB_NAME'" ),
				'utf-8'
			);
		} );

		it( 'should not modify wp-config.php if no default DB constants found', async () => {
			const wpConfigPath = require( 'path' ).join( mockSitePath, 'wp-config.php' );
			vi.spyOn( fs, 'existsSync' ).mockImplementation( ( p ) => p === wpConfigPath );
			vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( p ) => {
				if ( p === wpConfigPath ) {
					return wpConfigWithoutDbBlock;
				}
				return '';
			} );
			const fsWriteFileSyncSpy = vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( fsWriteFileSyncSpy ).not.toHaveBeenCalledWith(
				wpConfigPath,
				expect.anything(),
				'utf-8'
			);
		} );
	} );

	describe( 'Dependency updates', () => {
		it( 'calls updateServerFiles when online', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( updateServerFiles ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'skips updateServerFiles when offline', async () => {
			vi.mocked( isOnline ).mockResolvedValue( false );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( updateServerFiles ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Tracks: studio_site_created', () => {
		const mockRecord = vi.mocked( recordTracksEvent );

		const testBlueprint: Blueprint = { steps: [] };

		it( 'emits flow_type "new" with config + timing for a plain create', async () => {
			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( mockRecord ).toHaveBeenCalledTimes( 1 );
			expect( mockRecord ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_CREATE,
				expect.objectContaining( {
					flow_type: 'new',
					php_version: '8.3',
					wp_version: '6.5',
					custom_domain: false,
					ssl_enabled: false,
					channel: 'studio-cli',
				} )
			);
			const props = mockRecord.mock.calls[ 0 ][ 1 ] as Record< string, unknown >;
			expect( typeof props.time_ms ).toBe( 'number' );
			expect( props.time_ms as number ).toBeGreaterThanOrEqual( 0 );
		} );

		it( 'derives flow_type "blueprint" from a blueprint when no flowType is given', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				blueprint: { uri: '/home/test/blueprint.json', contents: testBlueprint },
			} );

			expect( mockRecord ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_CREATE,
				expect.objectContaining( { flow_type: 'blueprint' } )
			);
		} );

		it.each( [ 'import', 'sync', 'duplicate' ] as const )(
			'passes through flow_type "%s"',
			async ( flowType ) => {
				await runCommand( mockSitePath, { ...defaultTestOptions, flowType } );

				expect( mockRecord ).toHaveBeenCalledWith(
					TRACKS_EVENTS.SITE_CREATE,
					expect.objectContaining( { flow_type: flowType } )
				);
			}
		);

		it( 'an explicit flowType wins over blueprint inference', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				flowType: 'duplicate',
				blueprint: { uri: '/home/test/blueprint.json', contents: testBlueprint },
			} );

			expect( mockRecord ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_CREATE,
				expect.objectContaining( { flow_type: 'duplicate' } )
			);
		} );

		it( 'reports custom_domain/ssl_enabled as booleans and never sends the domain string', async () => {
			await runCommand( mockSitePath, {
				...defaultTestOptions,
				customDomain: 'mysite.local',
				enableHttps: true,
			} );

			expect( mockRecord ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_CREATE,
				expect.objectContaining( { custom_domain: true, ssl_enabled: true } )
			);
			const props = mockRecord.mock.calls[ 0 ][ 1 ];
			expect( JSON.stringify( props ) ).not.toContain( 'mysite.local' );
		} );

		it( 'reports wp_version resolved from disk', async () => {
			vi.mocked( getWordPressVersion ).mockReturnValue( '6.7.1' );

			await runCommand( mockSitePath, { ...defaultTestOptions } );

			expect( getWordPressVersion ).toHaveBeenCalledWith( mockSitePath );
			expect( mockRecord ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_CREATE,
				expect.objectContaining( { wp_version: '6.7.1' } )
			);
		} );

		it( 'does not emit when creation fails before completion', async () => {
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( mockSitePath, { ...defaultTestOptions } ) ).rejects.toThrow();

			expect( mockRecord ).not.toHaveBeenCalled();
		} );
	} );
} );
