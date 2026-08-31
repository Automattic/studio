import fs from 'fs';
import os from 'os';
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
import yargs from 'yargs';
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
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { buildCreateFromSourceBlueprint, registerCommand, runCommand } from '../create';

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
vi.mock( 'cli/lib/run-wp-cli-command' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/get-wordpress-version' );

describe( 'CLI: studio create', () => {
	const mockSitePath = '/test/site/new-site';
	const mockPort = 8881;
	const completedSsiReceipt =
		'{"schema":"static-site-importer/import-cli-receipt/v1","status":"completed","steps":1,"response":{"success":true}}';
	const mockWpCli = ( {
		exitCode = 0,
		stdout = completedSsiReceipt,
		stderr = '',
	}: {
		exitCode?: number;
		stdout?: string;
		stderr?: string;
	} = {} ) =>
		( {
			response: {
				exitCode: Promise.resolve( exitCode ),
				stdoutText: Promise.resolve( stdout ),
				stderrText: Promise.resolve( stderr ),
			},
			[ Symbol.dispose ]: vi.fn(),
		} ) as never;

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
		process.exitCode = undefined;

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
		vi.mocked( runWpCliCommandWithMessaging ).mockReset().mockResolvedValue( mockWpCli() );
		vi.mocked( logSiteDetails ).mockImplementation( () => {} );
		vi.mocked( openSiteInBrowser ).mockResolvedValue( undefined );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );
		vi.mocked( isOnline ).mockResolvedValue( true );
		vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );
		vi.mocked( copyLanguagePackToSite ).mockResolvedValue( false );
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.5' );
	} );

	afterEach( () => {
		process.exitCode = undefined;
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	} );

	const createCapturedSiteArtifact = () => {
		const artifactDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-captured-artifact-' ) );
		const artifactPath = path.join( artifactDir, 'artifact.json' );
		fs.writeFileSync(
			artifactPath,
			JSON.stringify( {
				schema: 'blocks-engine/php-transformer/site-artifact/v1',
				entrypoint: 'website/index.html',
				files: [ { path: 'website/index.html', content: '<main>Captured</main>' } ],
			} )
		);
		return artifactPath;
	};

	const buildCapturedSiteBlueprint = () => {
		return buildCreateFromSourceBlueprint(
			createCapturedSiteArtifact(),
			'Captured Site',
			'https://example.com/static-site-importer.zip',
			'https://example.com/'
		);
	};

	describe( 'Validation Errors', () => {
		it( 'validates and resolves the local Static Site Importer zip option', async () => {
			const pluginDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ssi-plugin-' ) );
			const createParser = () =>
				registerCommand(
					yargs( [] ).option( 'path', { type: 'string', default: mockSitePath } )
				).exitProcess( false );

			expect( () =>
				createParser().parse( [
					'create',
					'--from',
					'/tmp/source',
					'--static-site-importer-path',
					path.join( pluginDir, 'missing.zip' ),
				] )
			).toThrow( 'Must be an existing regular .zip file' );
			expect( () =>
				createParser().parse( [
					'create',
					'--from',
					'/tmp/source',
					'--static-site-importer-path',
					path.join( pluginDir, 'not-a-zip.txt' ),
				] )
			).toThrow( 'Must be a .zip file' );
		} );

		it( 'rejects simultaneous local and URL Static Site Importer inputs', async () => {
			const pluginDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ssi-plugin-' ) );
			const pluginPath = path.join( pluginDir, 'static-site-importer.zip' );
			fs.writeFileSync( pluginPath, 'plugin-bytes' );
			const parser = registerCommand(
				yargs( [] ).option( 'path', { type: 'string', default: mockSitePath } )
			).exitProcess( false );

			expect( () =>
				parser.parse( [
					'create',
					'--from',
					'/tmp/source',
					'--static-site-importer-path',
					pluginPath,
					'--static-site-importer-url',
					'https://example.com/static-site-importer.zip',
				] )
			).toThrow( 'mutually exclusive' );
		} );

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
		it( 'bundles a local Static Site Importer zip until Blueprint execution finishes', async () => {
			const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-source-test-' ) );
			const pluginDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ssi-plugin-' ) );
			const pluginPath = path.join( pluginDir, 'static-site-importer.zip' );
			fs.writeFileSync( path.join( sourceDir, 'index.html' ), '<main>Source</main>' );
			fs.writeFileSync( pluginPath, 'plugin-bytes' );
			const copySpy = vi.spyOn( fs, 'copyFileSync' );
			const rmSpy = vi.spyOn( fs.promises, 'rm' );
			vi.mocked( runBlueprint ).mockImplementation( async ( _site, _logger, options ) => {
				const bundlePath = path.dirname( options.blueprintUri! );
				const blueprint = JSON.parse( fs.readFileSync( options.blueprintUri!, 'utf8' ) );
				expect( blueprint.steps[ 0 ].pluginData ).toEqual( {
					resource: 'bundled',
					path: 'static-site-importer.zip',
				} );
				expect(
					fs.readFileSync( path.join( bundlePath, 'static-site-importer.zip' ), 'utf8' )
				).toBe( 'plugin-bytes' );
			} );
			const parser = registerCommand(
				yargs( [] ).option( 'path', { type: 'string', default: mockSitePath } )
			).exitProcess( false );

			await parser.parseAsync( [
				'create',
				'--from',
				sourceDir,
				'--static-site-importer-path',
				pluginPath,
				'--no-start',
				'--skip-browser',
			] );

			const bundlePath = path.dirname( copySpy.mock.calls[ 0 ][ 1 ] as string );
			expect( copySpy ).toHaveBeenCalledWith(
				pluginPath,
				path.join( bundlePath, 'static-site-importer.zip' )
			);
			expect( rmSpy ).toHaveBeenCalledWith( bundlePath, { recursive: true, force: true } );
			expect( rmSpy ).not.toHaveBeenCalledWith( pluginPath, expect.anything() );
		} );

		it( 'removes the bundled Blueprint when Blueprint execution fails', async () => {
			const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-source-test-' ) );
			const pluginDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ssi-plugin-' ) );
			const pluginPath = path.join( pluginDir, 'static-site-importer.zip' );
			fs.writeFileSync( path.join( sourceDir, 'index.html' ), '<main>Source</main>' );
			fs.writeFileSync( pluginPath, 'plugin-bytes' );
			const copySpy = vi.spyOn( fs, 'copyFileSync' );
			const rmSpy = vi.spyOn( fs.promises, 'rm' );
			vi.mocked( runBlueprint ).mockRejectedValue( new Error( 'Blueprint failed' ) );
			const parser = registerCommand(
				yargs( [] ).option( 'path', { type: 'string', default: mockSitePath } )
			).exitProcess( false );

			await parser.parseAsync( [
				'create',
				'--from',
				sourceDir,
				'--static-site-importer-path',
				pluginPath,
				'--no-start',
				'--skip-browser',
			] );

			const bundlePath = path.dirname( copySpy.mock.calls[ 0 ][ 1 ] as string );
			expect( rmSpy ).toHaveBeenCalledWith( bundlePath, { recursive: true, force: true } );
			expect( rmSpy ).not.toHaveBeenCalledWith( pluginPath, expect.anything() );
			expect( process.exitCode ).toBe( 1 );
		} );

		it( 'stages the canonical Static Site Importer request', () => {
			const blueprint = buildCapturedSiteBlueprint();
			const request = JSON.parse( blueprint.staticSiteImport.request );

			expect( request ).toMatchObject( {
				operation: 'apply',
				name: 'Captured Site',
				site_title: 'Captured Site',
				activate: true,
				overwrite: true,
				fail_on_quality: true,
				require_proven_dynamic_client_assets: true,
				seed_entities: true,
				materialize_dependencies: true,
				client_script_policy: 'isolated_preview',
				source_metadata: {
					source: 'studio-create-from',
					source_path: 'https://example.com/',
				},
				source: {
					type: 'files',
					entrypoint: 'website/index.html',
					files: [ { path: 'website/index.html', content: '<main>Captured</main>' } ],
				},
			} );
			expect( blueprint.staticSiteImport ).not.toHaveProperty( 'code' );
			expect( blueprint.staticSiteImport ).not.toHaveProperty( 'source' );
			expect(
				JSON.parse(
					buildCreateFromSourceBlueprint(
						createCapturedSiteArtifact(),
						'Captured Site',
						'https://example.com/static-site-importer.zip',
						'https://example.com/'
					).staticSiteImport.request
				)
			).toMatchObject( { operation: 'apply', fail_on_quality: true } );
		} );

		it( 'forwards artifact-declared classic materialization on the request', () => {
			const artifactDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-classic-artifact-' ) );
			const artifactPath = path.join( artifactDir, 'artifact.json' );
			fs.writeFileSync(
				artifactPath,
				JSON.stringify( {
					schema: 'blocks-engine/php-transformer/site-artifact/v1',
					entrypoint: 'website/index.html',
					theme_materialization: 'classic',
					files: [ { path: 'website/index.html', content: '<main>Home</main>' } ],
				} )
			);

			expect(
				JSON.parse(
					buildCreateFromSourceBlueprint(
						artifactPath,
						'Classic Site',
						'https://example.com/static-site-importer.zip'
					).staticSiteImport.request
				).theme_materialization
			).toBe( 'classic' );
		} );

		it( 'stages only the website root from a Data Liberation capture directory', () => {
			const captureDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-test-' ) );
			const websiteDir = fs.mkdtempSync( path.join( captureDir, 'website-' ) );
			fs.writeFileSync( path.join( websiteDir, 'index.html' ), '<main>Captured site</main>' );
			fs.writeFileSync( path.join( captureDir, 'diagnostics.json' ), '{"failures":[]}' );
			fs.writeFileSync(
				path.join( captureDir, 'capture-receipt.json' ),
				JSON.stringify( {
					schema: 'data-liberation/capture-receipt/v1',
					websiteRoot: path.basename( websiteDir ),
				} )
			);

			const blueprint = buildCreateFromSourceBlueprint(
				captureDir,
				'Liberated Site',
				'https://example.com/static-site-importer.zip'
			);
			const request = JSON.parse( blueprint.staticSiteImport.request );

			expect( request.source ).toEqual( {
				type: 'files',
				ref: 'request-bundle:source',
			} );
			expect( blueprint.staticSiteImport.sourcePath ).toBe( websiteDir );
			expect( blueprint.staticSiteImport.request.length ).toBeLessThan( 4096 );
		} );

		it( 'copies a request-bundled directory into the site before import', async () => {
			const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-source-bundle-' ) );
			fs.writeFileSync( path.join( sourceDir, 'index.html' ), '<main>Source bundle</main>' );
			const blueprint = buildCreateFromSourceBlueprint(
				sourceDir,
				'Bundled Site',
				'https://example.com/static-site-importer.zip'
			);
			const copySpy = vi.spyOn( fs.promises, 'cp' ).mockResolvedValue( undefined );
			vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } );

			expect( copySpy ).toHaveBeenCalledWith(
				sourceDir,
				path.join( mockSitePath, '.studio-import', 'source' ),
				{ recursive: true, errorOnExist: true, force: false }
			);
		} );

		it( 'rejects sources outside the canonical importer contract', () => {
			expect( () =>
				buildCreateFromSourceBlueprint( 'https://example.com/', 'Remote Site' )
			).toThrow( 'must be rendered by Data Liberation' );

			const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-figma-source-' ) );
			const figmaPath = path.join( sourceDir, 'design.fig' );
			fs.writeFileSync( figmaPath, 'figma' );
			expect( () => buildCreateFromSourceBlueprint( figmaPath, 'Figma Site' ) ).toThrow(
				'Figma files are not supported by the canonical Static Site Importer command.'
			);
		} );

		it( 'invokes the SSI host command once and consumes its terminal receipt', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			const writeSpy = vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			const rmSpy = vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } );

			const importCalls = vi
				.mocked( runWpCliCommandWithMessaging )
				.mock.calls.filter( ( call ) => call[ 1 ][ 0 ] === 'static-site-importer' );
			expect( importCalls ).toEqual( [
				[
					expect.objectContaining( { path: mockSitePath } ),
					[ 'static-site-importer', 'import', '--request=.studio-import/request.json' ],
					{},
				],
			] );
			expect( writeSpy ).toHaveBeenCalledWith(
				path.join( mockSitePath, '.studio-import', 'request.json' ),
				blueprint.staticSiteImport.request
			);
			expect( runWpCliCommandWithMessaging ).toHaveBeenCalledTimes( 4 );
			expect( runWpCliCommandWithMessaging ).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining( { path: mockSitePath } ),
				[ 'plugin', 'is-installed', 'static-site-importer' ],
				{}
			);
			expect( runWpCliCommandWithMessaging ).toHaveBeenNthCalledWith(
				3,
				expect.objectContaining( { path: mockSitePath } ),
				[ 'plugin', 'deactivate', 'static-site-importer', '--quiet' ],
				{}
			);
			expect( runWpCliCommandWithMessaging ).toHaveBeenNthCalledWith(
				4,
				expect.objectContaining( { path: mockSitePath } ),
				[ 'plugin', 'delete', 'static-site-importer' ],
				{}
			);
			expect( rmSpy ).toHaveBeenCalledWith( path.join( mockSitePath, '.studio-import' ), {
				recursive: true,
				force: true,
			} );
		} );

		it( 'rejects a successful process without a terminal SSI receipt', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			const rmSpy = vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );
			vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
				mockWpCli( { stdout: '{"status":"completed"}' } )
			);

			await expect(
				runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } )
			).rejects.toThrow( 'Failed to import static site' );
			expect( rmSpy ).not.toHaveBeenCalledWith( path.join( mockSitePath, '.studio-import' ), {
				recursive: true,
				force: true,
			} );
		} );

		it( 'reruns a matching staged request without reprovisioning the site', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			const existingSite = { ...mockExistingSite, path: mockSitePath };
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ existingSite ],
			} );
			createPathExistsMock( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );
			vi.spyOn( fs, 'existsSync' ).mockImplementation( ( filePath ) =>
				filePath.toString().endsWith( path.join( '.studio-import', 'request.json' ) )
			);
			vi.spyOn( fs, 'readFileSync' ).mockReturnValue( blueprint.staticSiteImport.request );
			const writeSpy = vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );

			await runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } );

			expect( runBlueprint ).not.toHaveBeenCalled();
			expect( writeSpy ).not.toHaveBeenCalledWith(
				path.join( mockSitePath, '.studio-import', 'request.json' ),
				expect.anything()
			);
			expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith(
				existingSite,
				[ 'static-site-importer', 'import', '--request=.studio-import/request.json' ],
				expect.objectContaining( {
					liveOutput: true,
					onLiveOutput: expect.any( Function ),
				} )
			);
		} );

		it( 'rejects a registered site whose staged request does not match', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			const existingSite = { ...mockExistingSite, path: mockSitePath };
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ existingSite ],
			} );
			createPathExistsMock( true );
			vi.mocked( isEmptyDir ).mockResolvedValue( false );
			vi.mocked( isWordPressDirectory ).mockReturnValue( true );
			vi.spyOn( fs, 'existsSync' ).mockImplementation( ( filePath ) =>
				filePath.toString().endsWith( path.join( '.studio-import', 'request.json' ) )
			);
			vi.spyOn( fs, 'readFileSync' ).mockReturnValue( '{"operation":"apply"}\n' );
			const rmSpy = vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );

			await expect(
				runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } )
			).rejects.toThrow( 'The selected directory is already in use.' );

			expect( runWpCliCommandWithMessaging ).not.toHaveBeenCalled();
			expect( rmSpy ).not.toHaveBeenCalledWith( path.join( mockSitePath, '.studio-import' ), {
				recursive: true,
				force: true,
			} );
		} );

		it( 'consumes a complete terminal receipt larger than the former 64 KiB tail', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );
			vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
				mockWpCli( {
					stdout: JSON.stringify( {
						schema: 'static-site-importer/import-cli-receipt/v1',
						status: 'completed',
						steps: 1,
						response: { success: true, artifact: 'x'.repeat( 128 * 1024 ) },
					} ),
				} )
			);

			await runCommand( mockSitePath, {
				...defaultTestOptions,
				blueprint,
				noStart: true,
				runtime: SITE_RUNTIME_NATIVE_PHP,
			} );

			expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith(
				expect.objectContaining( { runtime: SITE_RUNTIME_NATIVE_PHP } ),
				[ 'static-site-importer', 'import', '--request=.studio-import/request.json' ],
				expect.objectContaining( {
					liveOutput: true,
					onLiveOutput: expect.any( Function ),
				} )
			);
		} );

		it( 'keeps staging when plugin cleanup fails after a successful import', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			const rmSpy = vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );
			const reportErrorSpy = vi.spyOn( Logger.prototype, 'reportError' );
			vi.mocked( runWpCliCommandWithMessaging )
				.mockReset()
				// import succeeds, the plugin is installed, then deactivation fails.
				.mockResolvedValueOnce( mockWpCli() )
				.mockResolvedValueOnce( mockWpCli( { stdout: '' } ) )
				.mockResolvedValueOnce(
					mockWpCli( { exitCode: 1, stdout: '', stderr: 'cleanup failed' } )
				);

			await expect(
				runCommand( mockSitePath, { ...defaultTestOptions, blueprint, noStart: true } )
			).resolves.toBeUndefined();

			expect( reportErrorSpy ).toHaveBeenCalledWith(
				expect.objectContaining( { message: expect.stringContaining( 'cleanup failed' ) } ),
				false
			);
			expect( removeSiteFromConfig ).not.toHaveBeenCalled();
			expect( rmSpy ).not.toHaveBeenCalledWith( path.join( mockSitePath, '.studio-import' ), {
				recursive: true,
				force: true,
			} );
		} );

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

		it( 'should retain a new site and its state when the out-of-band static import fails', async () => {
			const blueprint = buildCapturedSiteBlueprint();
			vi.spyOn( fs, 'writeFileSync' ).mockImplementation( () => {} );
			const rmSpy = vi.spyOn( fs, 'rmSync' ).mockImplementation( () => {} );
			const fsRmSpy = vi.spyOn( fs.promises, 'rm' ).mockResolvedValue( undefined );
			vi.mocked( runWpCliCommandWithMessaging )
				.mockReset()
				.mockResolvedValue(
					mockWpCli( {
						exitCode: 1,
						stdout: JSON.stringify( {
							schema: 'static-site-importer/import-cli-receipt/v1',
							status: 'failed',
							steps: 1,
							response: {
								success: false,
								error: {
									code: 'static_site_importer_quality_failed',
									message: 'quality gate failed',
								},
							},
						} ),
					} )
				);

			await expect(
				runCommand( mockSitePath, {
					...defaultTestOptions,
					blueprint,
					noStart: true,
				} )
			).rejects.toThrow( /quality gate failed/ );

			expect( runWpCliCommandWithMessaging ).toHaveBeenCalledTimes( 1 );
			expect( removeSiteFromConfig ).not.toHaveBeenCalled();
			expect( fsRmSpy ).not.toHaveBeenCalledWith( mockSitePath, {
				recursive: true,
				force: true,
			} );
			expect( rmSpy ).not.toHaveBeenCalledWith( path.join( mockSitePath, '.studio-import' ), {
				recursive: true,
				force: true,
			} );
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
