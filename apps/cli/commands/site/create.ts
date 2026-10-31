import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { installSelectedSkillsToSite } from '@studio/common/lib/agent-skills';
import {
	__isStepDefinition,
	extractFormValuesFromBlueprint,
} from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { normalizeLandingPage } from '@studio/common/lib/landing-page';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { isNetworkError } from '@studio/common/lib/network-utils';
import {
	createPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import {
	type TracksSiteCreateFlowType,
	type TracksSiteCreateSource,
} from '@studio/common/lib/record-tracks-event';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { sortSites } from '@studio/common/lib/sort-sites';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteUrl, removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { type liberateWebsite } from 'cli/lib/data-liberation-client';
import { getBundledSkillsPath, getWordPressVersionPath } from 'cli/lib/dependency-management/paths';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import { confirm, input, password, select } from 'cli/lib/prompts';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { generateSiteName } from 'cli/lib/site-name';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import {
	completeSourceImport,
	prepareSourceImport,
	removeStaticSiteImportBundle,
	type PreparedSourceImport,
} from 'cli/lib/static-site-import/prepare';
import { StaticSiteImportRun } from 'cli/lib/static-site-import/run';
import {
	classifySourceImport,
	isUrl,
	sourceSiteName,
	type StaticSiteImportPlan,
} from 'cli/lib/static-site-import/source';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { StatsGroup } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import {} from 'cli/lib/wp-version-option';
import { Logger, LoggerError } from 'cli/logger';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';
import type { builder } from 'cli/commands/site/create.command';
import type { CommandArgs } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();
export type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
		staticSiteImport?: StaticSiteImportPlan;
	};
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart: boolean;
	skipBrowser: boolean;
	skipLogDetails: boolean;
	flowType?: TracksSiteCreateFlowType;
	source?: TracksSiteCreateSource;
};

const SITE_CREATE_FLOW_TYPES: readonly TracksSiteCreateFlowType[] = [
	'new',
	'blueprint',
	'import',
	'sync',
	'duplicate',
	'ai',
];

function parseFlowType( value: string | undefined ): TracksSiteCreateFlowType | undefined {
	return SITE_CREATE_FLOW_TYPES.find( ( flowType ) => flowType === value );
}

export async function runCommand(
	sitePath: string,
	options: CreateCommandOptions,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< void > {
	const phpVersion = validateSupportedPhpVersion( options.phpVersion );
	const staticSiteImport = options.blueprint?.staticSiteImport;
	const importRun = staticSiteImport
		? new StaticSiteImportRun( sitePath, staticSiteImport, logger )
		: undefined;

	try {
		const updated = await updateServerFiles( options.wpVersion === DEFAULT_WORDPRESS_VERSION );
		if ( updated ) {
			logger.reportSuccess( __( 'Dependencies updated' ) );
		}
	} catch ( error ) {
		// Errors here aren't critical and likely relate to things outside the user's control,
		// like network issues or bad API responses. Report them only in development.
		if ( process.env.NODE_ENV !== 'production' ) {
			const loggerError = new LoggerError( 'Failed to update dependencies', error );
			logger.reportError( loggerError, false );
		}
	}

	const createStartedAt = Date.now();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration…' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprintUri: string | undefined;
		let blueprint: BlueprintV1Declaration | undefined;
		let blueprintCredentials: { adminUsername?: string; adminPassword?: string } | null = null;

		if ( options.blueprint ) {
			const validation = await validateBlueprintData( options.blueprint.contents );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
			// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
			const formValues = extractFormValuesFromBlueprint(
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = options.blueprint.contents as BlueprintV1Declaration;

			const blueprintHasMultisite = blueprint?.steps
				?.filter( __isStepDefinition )
				.some( ( step ) => step.step === 'enableMultisite' );

			if ( blueprintHasMultisite && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
		}

		const cliConfig = await readCliConfig();
		const existingSite = cliConfig.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
		if ( importRun?.canResumeOn( existingSite ) ) {
			await importRun.resume( existingSite );
			return;
		}
		if ( existingSite ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of cliConfig.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = cliConfig.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory…' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		if ( options.wpVersion === 'latest' ) {
			const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

			if ( ! ( await pathExists( bundledWPPath ) ) ) {
				throw new LoggerError(
					__(
						'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
					)
				);
			}

			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await recursiveCopyDirectory( bundledWPPath, sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		} else if ( ! isWordPressDirResult ) {
			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Downloading WordPress %s…' ), options.wpVersion )
			);
			await downloadWordPress( options.wpVersion ).catch( ( error: unknown ) => {
				if ( isNetworkError( error ) ) {
					throw new LoggerError(
						__(
							'Cannot set up WordPress while offline. Specific WordPress versions require an internet connection. Try using "latest" version or ensure internet connectivity.'
						),
						error
					);
				}
				throw error;
			} );
			logger.reportSuccess( __( 'WordPress files downloaded' ) );

			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Copying WordPress %s…' ), options.wpVersion )
			);
			await recursiveCopyDirectory( getWordPressVersionPath( options.wpVersion ), sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		try {
			const sharedConfig = await readSharedConfig();
			const selectedSkills = sharedConfig.selectedSkills ?? [];
			await installSelectedSkillsToSite(
				{ path: sitePath },
				getBundledSkillsPath(),
				selectedSkills
			);
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to install agent skills. Proceeding anyway…' ), error ),
				false
			);
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = options.siteId || crypto.randomUUID();

		// Determine admin credentials: CLI args > Blueprint > defaults
		// External passwords need to be encoded; createPassword() already returns encoded
		const adminUsername = options.adminUsername || blueprintCredentials?.adminUsername || undefined;
		if ( adminUsername ) {
			const usernameError = validateAdminUsername( adminUsername );
			if ( usernameError ) {
				throw new LoggerError( usernameError );
			}
		}
		const adminEmail = options.adminEmail?.trim() || undefined;
		if ( adminEmail ) {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}

		const externalPassword = options.adminPassword || blueprintCredentials?.adminPassword;
		const adminPassword = externalPassword ? encodePassword( externalPassword ) : createPassword();

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if (
			siteLanguage &&
			siteLanguage !== DEFAULT_LOCALE &&
			options.wpVersion === DEFAULT_WORDPRESS_VERSION
		) {
			await copyLanguagePackToSite( sitePath, siteLanguage );
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
			port,
			phpVersion,
			fileAccess: options.fileAccess,
			running: false,
			status: 'ready',
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			landingPage: normalizeLandingPage( blueprint?.landingPage ),
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

		try {
			await lockCliConfig();
			const userData = await readCliConfig();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveCliConfig( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockCliConfig();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connectToDaemon();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, logger, 'create', {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
					siteLanguage,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				stripWpConfigDbConstants( sitePath );

				siteDetails.running = true;
				siteDetails.url = siteDetails.customDomain
					? `${ siteDetails.enableHttps ? 'https' : 'http' }://${ siteDetails.customDomain }`
					: `http://localhost:${ siteDetails.port }`;

				await importRun?.run( siteDetails );

				if ( ! options.skipLogDetails ) {
					logSiteDetails( siteDetails );
				}
				if ( ! options.skipBrowser ) {
					await openSiteInBrowser( siteDetails );
				}
			} catch ( error ) {
				if ( ! importRun?.retainSiteAfterFailure( siteDetails ) ) {
					await removeSiteFromConfig( siteDetails.id );
					if ( ! isWordPressDirResult ) {
						await fs.promises.rm( sitePath, { recursive: true, force: true } );
					}
				}
				throw new LoggerError(
					importRun
						? __( 'Failed to import static site' )
						: __( 'Failed to start WordPress server' ),
					error
				);
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connectToDaemon();
				logger.reportSuccess( __( 'Process daemon started' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Applying Blueprint…' ) );
				try {
					if ( ! blueprintUri ) {
						throw new LoggerError( __( 'Blueprint source path is missing' ) );
					}
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri,
						siteLanguage,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
					await importRun?.run( siteDetails );
				} catch ( error ) {
					if ( ! importRun?.retainSiteAfterFailure( siteDetails ) ) {
						await removeSiteFromConfig( siteDetails.id );
						if ( ! isWordPressDirResult ) {
							await fs.promises.rm( sitePath, { recursive: true, force: true } );
						}
					}
					throw new LoggerError(
						importRun ? __( 'Failed to import static site' ) : __( 'Failed to apply Blueprint' ),
						error
					);
				}
			}
			console.log( '' );
			console.log( __( 'Site created successfully' ) );
			console.log( '' );
			if ( ! options.skipLogDetails ) {
				logSiteDetails( siteDetails );
			}
			console.log( __( 'Run "studio start" to start the site.' ) );
		}

		logger.reportResult( { ...siteDetails, url: getSiteUrl( siteDetails ) } );

		// Tracks: the CLI is the sole emitter of site-creation, so every path a site comes into
		// existence (new/blueprint/import/sync/duplicate, app-spawned or standalone) is counted once.
		// Fires only on success; wrapped so best-effort telemetry can never fail a site creation.
		try {
			await recordTracksEvent( TRACKS_EVENTS.SITE_CREATE, {
				flow_type: options.flowType ?? ( blueprint ? 'blueprint' : 'new' ),
				// Only a static site import carries `source`; every other create omits it.
				source: options.flowType === 'static_site_import' ? options.source : undefined,
				php_version: siteDetails.phpVersion,
				wp_version: getWordPressVersion( sitePath ),
				custom_domain: !! options.customDomain,
				ssl_enabled: !! options.enableHttps,
				time_ms: Date.now() - createStartedAt,
				...getTracksOrigin(),
			} );
		} catch {
			// Best-effort telemetry — never block or fail a site creation.
		}

		await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: siteDetails.id } } );
	} finally {
		importRun?.finish();
		await disconnectFromDaemon();
	}
}

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch Blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse Blueprint JSON' ), error );
	}
}

function stripWpConfigDbConstants( sitePath: string ): void {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}
	const content = fs.readFileSync( wpConfigPath, 'utf-8' );
	if ( hasDefaultDbBlock( content ) ) {
		fs.writeFileSync( wpConfigPath, removeDbConstants( content ), 'utf-8' );
	}
}

function readBlueprint( blueprintPath: string ) {
	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse Blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

export async function commandHandler(
	argv: CommandArgs< typeof builder >,
	dependencies: { liberate?: typeof liberateWebsite } = {}
) {
	const sourceUrl = argv.from && isUrl( argv.from ) ? argv.from : undefined;
	let siteName = argv.from ? sourceSiteName( argv.from, argv.name ) : argv.name;
	let sitePath = argv.path;
	let wpVersion = argv.wp;
	let phpVersion = argv.php;
	let customDomain = argv.domain;
	let enableHttps = !! argv.https;
	let adminUsername = argv.adminUsername;
	let adminPassword = argv.adminPassword;
	let adminEmail = argv.adminEmail;
	const fileAccess = argv.fileAccess;

	// Validate and resolve the WordPress version against available versions before prompting
	if ( wpVersion && wpVersion !== 'latest' && wpVersion !== 'nightly' ) {
		try {
			defaultLogger.reportStart( LoggerAction.VALIDATE, __( 'Checking WordPress version…' ) );
			const availableVersions = await fetchWordPressVersions();
			const matchedVersion = availableVersions.find(
				( v ) => v.value === wpVersion || v.value.startsWith( wpVersion + '.' )
			);
			if ( ! matchedVersion ) {
				const versionLabels = availableVersions
					.filter( ( v ) => v.value !== 'latest' )
					.map( ( v ) => v.label );
				defaultLogger.reportError(
					new LoggerError(
						sprintf(
							/* translators: %1$s: requested version, %2$s: list of available versions */
							__( 'WordPress version "%1$s" is not available. Available versions: %2$s' ),
							wpVersion,
							versionLabels.join( ', ' )
						)
					)
				);
				return;
			}
			// Resolve short versions to full versions (e.g. "6.7" → "6.7.2")
			if ( matchedVersion.value !== wpVersion ) {
				defaultLogger.reportSuccess(
					sprintf(
						/* translators: %1$s: requested version, %2$s: resolved version */
						__( 'WordPress version: %1$s → %2$s' ),
						wpVersion,
						matchedVersion.value
					)
				);
			} else {
				defaultLogger.reportSuccess(
					sprintf(
						/* translators: %s: WordPress version */
						__( 'WordPress version: %s' ),
						wpVersion
					)
				);
			}
			wpVersion = matchedVersion.value;
		} catch {
			// If we can't fetch versions (network issue), let it proceed and fail later
		}
	}

	try {
		if ( process.stdin.isTTY ) {
			if ( ! siteName && ! sourceUrl ) {
				const defaultName = await generateSiteName();
				siteName = await input( {
					message: __( 'Site name:' ),
					default: defaultName,
				} );
			}

			const pathWasExplicitlyProvided = sitePath !== process.cwd();
			if ( ! pathWasExplicitlyProvided ) {
				const suggestedPath = getDefaultSitePath( siteName || __( 'My WordPress Website' ) );
				const promptedPath = await input( {
					message: __( 'Site path:' ),
					default: suggestedPath,
				} );
				sitePath = path.resolve( untildify( promptedPath ) );
			}

			if ( ! wpVersion ) {
				let wpChoices: { name: string; value: string }[];
				try {
					const versions = await fetchWordPressVersions();
					wpChoices = versions.map( ( v ) => ( {
						name:
							v.value === DEFAULT_WORDPRESS_VERSION
								? sprintf( __( 'Auto-update (%s)' ), v.label )
								: v.label,
						value: v.value,
					} ) );
				} catch {
					// Offline or API failure — offer only the auto-update mode
					wpChoices = [
						{
							name: __( 'Auto-update (recommended)' ),
							value: DEFAULT_WORDPRESS_VERSION,
						},
					];
				}
				wpVersion = await select( {
					message: __( 'WordPress version:' ),
					choices: wpChoices,
					default: DEFAULT_WORDPRESS_VERSION,
					loop: false,
				} );
			}

			if ( ! phpVersion ) {
				phpVersion = await select( {
					message: __( 'PHP version:' ),
					choices: SupportedPHPVersions.map( ( v ) => ( {
						name: v === RecommendedPHPVersion ? sprintf( __( '%s (recommended)' ), v ) : v,
						value: v,
					} ) ),
					default: RecommendedPHPVersion,
				} );
			}

			if ( ! customDomain ) {
				const cliConfig = await readCliConfig();
				const existingDomains = cliConfig.sites
					.map( ( site ) => site.customDomain )
					.filter( ( domain ): domain is string => Boolean( domain ) );

				customDomain = await input( {
					message: __( 'Custom domain (leave empty to skip):' ),
					validate: ( value ) =>
						getDomainNameValidationError( !! value, value, existingDomains ) || true,
				} );
			}

			if ( customDomain && ! argv.https ) {
				enableHttps = await confirm( {
					message: __( 'Enable HTTPS?' ),
					default: false,
				} );
			}

			if ( ! adminUsername ) {
				adminUsername = await input( {
					message: __( 'Admin username:' ),
					default: 'admin',
					validate: ( value ) => validateAdminUsername( value ) || true,
				} );
			}

			if ( ! adminPassword ) {
				adminPassword = await password( {
					message: __( 'Admin password (leave empty to auto-generate):' ),
					mask: true,
				} );
				if ( ! adminPassword ) {
					adminPassword = undefined;
				}
			}

			if ( ! adminEmail ) {
				adminEmail = await input( {
					message: __( 'Admin email:' ),
					default: 'admin@localhost.com',
					validate: ( value ) => validateAdminEmail( value ) || true,
				} );
			}
		}
	} catch {
		// User cancelled the prompt (Ctrl+C)
		return;
	}

	// Apply defaults for non-interactive mode when flags weren't provided
	wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;

	const config: CreateCommandOptions = {
		name: siteName,
		siteId: argv.id,
		wpVersion,
		phpVersion: phpVersion ?? RecommendedPHPVersion,
		fileAccess,
		customDomain,
		enableHttps,
		adminUsername,
		adminPassword,
		adminEmail,
		noStart: ! argv.start,
		skipBrowser: !! argv.skipBrowser,
		skipLogDetails: !! argv.skipLogDetails,
		flowType: parseFlowType( argv.flowType ),
	};

	try {
		let preparedImport: PreparedSourceImport | undefined;
		if ( argv.from ) {
			preparedImport = await prepareSourceImport( argv.from, sitePath, siteName, defaultLogger, {
				staticSiteImporter: argv.staticSiteImporterPath
					? { path: argv.staticSiteImporterPath }
					: argv.staticSiteImporterUrl,
				liberate: dependencies.liberate,
			} );
			config.blueprint = preparedImport.blueprint;
			config.name = preparedImport.siteName;
			// A `--from` create becomes a blueprint internally, so the inference must win over the
			// `--flow-type` hint to stay measurable as a static site import.
			config.flowType = 'static_site_import';
			config.source = classifySourceImport( argv.from );
		} else if ( argv.blueprint ) {
			if ( isUrl( argv.blueprint ) ) {
				config.blueprint = {
					uri: argv.blueprint,
					contents: await fetchBlueprint( argv.blueprint ),
				};
			} else {
				const uri = path.resolve( untildify( argv.blueprint ) );

				config.blueprint = {
					uri,
					contents: readBlueprint( uri ),
				};

				// When invoked by the desktop app, the blueprint contents come from a temp file
				// but resources should be resolved relative to the original file location.
				// For gallery blueprints the path is a URL; use it directly.
				if ( argv.originalBlueprintPath ) {
					const originalPath = argv.originalBlueprintPath;
					config.blueprint.uri = isUrl( originalPath )
						? originalPath
						: path.resolve( originalPath );
				}
			}
		}

		try {
			await runCommand( sitePath, config );
			if ( preparedImport ) {
				await completeSourceImport( preparedImport, sitePath, {
					keepSource: !! argv.keepSource,
				} );
			}
		} finally {
			await removeStaticSiteImportBundle( config.blueprint?.staticSiteImport );
		}

		if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
			bumpStat(
				__IS_PACKAGED_FOR_NPM__
					? StatsGroup.STUDIO_CLI_SITE_CREATE_NPM
					: StatsGroup.STUDIO_CLI_SITE_CREATE_APP,
				getPlatformMetric()
			);
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			defaultLogger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create site' ), error );
			defaultLogger.reportError( loggerError );
		}
	}
}
