import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import {
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import {
	getSiteFileAccess,
	isFileAccessAllowedForRuntime,
	siteFileAccessSchema,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { siteNeedsRestart } from '@studio/common/lib/site-needs-restart';
import {
	getSiteRuntime,
	siteModeSchema,
	SITE_MODE_NATIVE,
	SITE_MODE_SANDBOX,
	siteRuntimeFromMode,
	type SiteMode,
} from '@studio/common/lib/site-runtime';
import {
	getWordPressVersionUrl,
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { updateDomainInHosts } from 'cli/lib/hosts-file';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { withSiteOperation } from 'cli/lib/site-operations';
import { setupCustomDomain } from 'cli/lib/site-utils';
import { ValidationError } from 'cli/lib/validation-error';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export interface SetCommandOptions {
	name?: string;
	domain?: string;
	https?: boolean;
	php?: string;
	wp?: string;
	runtime?: SiteMode;
	fileAccess?: SiteFileAccess;
	xdebug?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	debugLog?: boolean;
	debugDisplay?: boolean;
}

export async function runCommand( sitePath: string, options: SetCommandOptions ): Promise< void > {
	const validated = validateSetOptions( options );
	return withSiteOperation( sitePath, 'settings', () => setSiteConfig( sitePath, validated ) );
}

// Runs before the operation is recorded, so an invalid edit fails without
// touching the config file or briefly blocking the site. Returns the
// options with `adminEmail` normalized (blank means "leave it alone").
function validateSetOptions( options: SetCommandOptions ): SetCommandOptions {
	const {
		name,
		domain,
		https,
		php,
		wp,
		runtime,
		fileAccess,
		xdebug,
		adminUsername,
		adminPassword,
		debugLog,
		debugDisplay,
	} = options;
	let { adminEmail } = options;

	if (
		name === undefined &&
		domain === undefined &&
		https === undefined &&
		php === undefined &&
		wp === undefined &&
		runtime === undefined &&
		fileAccess === undefined &&
		xdebug === undefined &&
		adminUsername === undefined &&
		adminPassword === undefined &&
		adminEmail === undefined &&
		debugLog === undefined &&
		debugDisplay === undefined
	) {
		throw new LoggerError(
			__(
				'At least one option (--name, --domain, --https, --php, --wp, --runtime, --file-access, --xdebug, --admin-username, --admin-password, --admin-email, --debug-log, --debug-display) is required.'
			)
		);
	}

	if ( name !== undefined && ! name.trim() ) {
		throw new LoggerError( __( 'Site name cannot be empty.' ) );
	}

	if ( adminUsername !== undefined ) {
		const usernameError = validateAdminUsername( adminUsername );
		if ( usernameError ) {
			throw new LoggerError( usernameError );
		}
	}

	if ( adminPassword !== undefined && ! adminPassword.trim() ) {
		throw new LoggerError( __( 'Admin password cannot be empty.' ) );
	}

	// Static check, so it belongs out here with the rest. The runtime-specific
	// PHP check further down needs the site record and has to stay inside.
	if ( options.php !== undefined ) {
		validateSupportedPhpVersion( options.php );
	}

	if ( adminEmail !== undefined ) {
		if ( ! adminEmail.trim() ) {
			adminEmail = undefined;
		} else {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}
	}

	return { ...options, adminEmail };
}

async function setSiteConfig( sitePath: string, options: SetCommandOptions ): Promise< void > {
	const {
		name,
		domain,
		https,
		php,
		wp,
		runtime,
		fileAccess,
		xdebug,
		adminUsername,
		adminPassword,
		adminEmail,
		debugLog,
		debugDisplay,
	} = options;

	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		let site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		const effectiveRuntime = runtime ? siteRuntimeFromMode( runtime ) : getSiteRuntime( site );
		const effectiveFileAccess = fileAccess ?? getSiteFileAccess( site );
		if ( ! isFileAccessAllowedForRuntime( effectiveRuntime, effectiveFileAccess ) ) {
			throw new LoggerError(
				__(
					'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory. Use --runtime native or --file-access site-directory.'
				)
			);
		}
		const validatedPhp = php === undefined ? undefined : validateSupportedPhpVersion( php );

		const initialCliConfig = await readCliConfig();

		if ( domain ) {
			const existingDomainNames = initialCliConfig.sites
				.filter( ( s ) => s.id !== site.id )
				.map( ( s ) => s.customDomain )
				.filter( ( d ): d is string => Boolean( d ) );
			const domainError = getDomainNameValidationError( true, domain, existingDomainNames );
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		if ( https === true ) {
			const effectiveDomain = domain ?? site.customDomain;
			if ( ! effectiveDomain ) {
				throw new LoggerError( __( 'HTTPS requires a custom domain. Use --domain to set one.' ) );
			}
		}

		if ( xdebug === true ) {
			const otherXdebugSite = initialCliConfig.sites.find(
				( s ) => s.enableXdebug && s.id !== site.id
			);
			if ( otherXdebugSite ) {
				throw new LoggerError(
					sprintf(
						/* translators: %s: site name */
						__( 'Only one site can have Xdebug enabled at a time. Disable Xdebug on "%s" first.' ),
						otherXdebugSite.name
					)
				);
			}
		}

		const nameChanged = name !== undefined && name !== site.name;
		const domainChanged = domain !== undefined && domain !== site.customDomain;
		const httpsChanged = https !== undefined && https !== site.enableHttps;
		const phpChanged = validatedPhp !== undefined && validatedPhp !== site.phpVersion;
		const wpChanged = wp !== undefined;
		const runtimeChanged = runtime !== undefined && effectiveRuntime !== getSiteRuntime( site );
		const fileAccessChanged = fileAccess !== undefined && fileAccess !== getSiteFileAccess( site );
		const xdebugChanged = xdebug !== undefined && xdebug !== site.enableXdebug;
		const adminUsernameChanged =
			adminUsername !== undefined && adminUsername !== ( site.adminUsername ?? 'admin' );
		const adminPasswordChanged = adminPassword !== undefined;
		const adminEmailChanged = adminEmail !== undefined && adminEmail !== ( site.adminEmail ?? '' );
		const credentialsChanged = adminUsernameChanged || adminPasswordChanged || adminEmailChanged;
		const debugLogChanged = debugLog !== undefined && debugLog !== site.enableDebugLog;
		const debugDisplayChanged =
			debugDisplay !== undefined && debugDisplay !== site.enableDebugDisplay;

		const hasChanges =
			nameChanged ||
			domainChanged ||
			httpsChanged ||
			phpChanged ||
			wpChanged ||
			runtimeChanged ||
			fileAccessChanged ||
			xdebugChanged ||
			credentialsChanged ||
			debugLogChanged ||
			debugDisplayChanged;
		if ( ! hasChanges ) {
			throw new LoggerError(
				__( 'No changes to apply. The site already has the specified settings.' )
			);
		}

		const needsRestart = siteNeedsRestart( {
			domainChanged,
			httpsChanged,
			phpChanged,
			wpChanged,
			runtimeChanged,
			fileAccessChanged,
			xdebugChanged,
			credentialsChanged,
			debugLogChanged,
			debugDisplayChanged,
		} );
		const oldDomain = site.customDomain;

		try {
			await lockCliConfig();
			const cliConfig = await readCliConfig();
			const foundSite = cliConfig.sites.find( ( s ) => arePathsEqual( s.path, sitePath ) );
			if ( ! foundSite ) {
				throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
			}

			if ( nameChanged ) {
				foundSite.name = name!;
			}
			if ( domainChanged ) {
				foundSite.customDomain = domain || undefined;
			}
			if ( httpsChanged ) {
				foundSite.enableHttps = https;
			}
			if ( phpChanged ) {
				foundSite.phpVersion = validatedPhp!;
			}
			if ( runtimeChanged ) {
				foundSite.runtime = effectiveRuntime;
			}
			if ( fileAccessChanged ) {
				foundSite.fileAccess = fileAccess;
			}
			if ( xdebugChanged ) {
				foundSite.enableXdebug = xdebug;
			}
			if ( adminUsernameChanged ) {
				foundSite.adminUsername = adminUsername!;
			}
			if ( adminPasswordChanged ) {
				foundSite.adminPassword = encodePassword( adminPassword! );
			}
			if ( adminEmailChanged ) {
				foundSite.adminEmail = adminEmail!;
			}
			if ( debugLogChanged ) {
				foundSite.enableDebugLog = debugLog;
			}
			if ( debugDisplayChanged ) {
				foundSite.enableDebugDisplay = debugDisplay;
			}

			await saveCliConfig( cliConfig );
			site = foundSite;
		} finally {
			await unlockCliConfig();
		}

		if ( domainChanged ) {
			logger.reportStart( LoggerAction.ADD_DOMAIN_TO_HOSTS, __( 'Updating hosts file…' ) );
			await updateDomainInHosts( oldDomain, domain, site.port );
			logger.reportSuccess( __( 'Hosts file updated' ) );
		}

		if ( httpsChanged && https && site.customDomain ) {
			logger.reportStart( LoggerAction.GENERATE_CERT, __( 'Generating SSL certificates…' ) );
			await generateSiteCertificate( site.customDomain );
			logger.reportSuccess( __( 'SSL certificates generated' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const wasRunning = await isServerRunning( site.id );

		if ( needsRestart && wasRunning ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
		}

		if ( wpChanged ) {
			logger.reportStart( LoggerAction.SET_WP_VERSION, __( 'Updating WordPress version…' ) );
			const zipUrl = getWordPressVersionUrl( wp );

			await using command = await runWpCliCommand( site, [
				'core',
				'update',
				zipUrl,
				'--force',
				'--skip-plugins',
				'--skip-themes',
			] );

			const exitCode = await command.response.exitCode;
			if ( exitCode !== 0 ) {
				throw new LoggerError( sprintf( __( 'Failed to update WordPress version to %s' ), wp ) );
			}
			logger.reportSuccess( __( 'WordPress version updated' ) );

			try {
				await lockCliConfig();
				const cliConfig = await readCliConfig();
				const updatedSite = cliConfig.sites.find( ( s ) => s.id === site.id );
				if ( updatedSite ) {
					updatedSite.isWpAutoUpdating = wp === DEFAULT_WORDPRESS_VERSION;
					await saveCliConfig( cliConfig );
					site = updatedSite;
				}
			} finally {
				await unlockCliConfig();
			}
		}

		if ( needsRestart && wasRunning ) {
			if ( site.customDomain ) {
				await setupCustomDomain( site, logger, { skipHostsUpdate: true } );
			}

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
			await startWordPressServer( site, logger );
			logger.reportSuccess( __( 'WordPress server started' ) );
		}

		logger.reportSuccess( __( 'Site configuration updated' ) );

		await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId: site.id } } );
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set',
		describe: __( 'Configure site settings' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'name', {
					type: 'string',
					description: __( 'Site name' ),
				} )
				.option( 'domain', {
					type: 'string',
					description: __( 'Custom domain (must end with .local)' ),
				} )
				.option( 'https', {
					type: 'boolean',
					description: __( 'Enable HTTPS (requires custom domain)' ),
				} )
				.option( 'php', {
					type: 'string',
					description: __( 'PHP version' ),
					choices: SupportedPHPVersions,
				} )
				.option( 'wp', {
					type: 'string',
					description: __(
						'WordPress version. Use "latest" to let the site auto-update, or pin a version (e.g., "6.4", "6.4.1")'
					),
					coerce: ( value: string ) => {
						if ( ! isValidWordPressVersion( value ) ) {
							throw new ValidationError(
								'wp',
								value,
								__(
									'Must be: "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
								)
							);
						}
						if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
							throw new ValidationError(
								'wp',
								value,
								sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
							);
						}
						return value;
					},
				} )
				.option( 'runtime', {
					type: 'string',
					description: __(
						'Run the site with native PHP ("native") or in the Playground sandbox ("sandbox")'
					),
					choices: [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ],
				} )
				.option( 'file-access', {
					type: 'string',
					description: __(
						'Which files PHP can access with the native PHP runtime: the site directory only, or all files'
					),
					choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ],
				} )
				.option( 'xdebug', {
					type: 'boolean',
					description: __( 'Enable Xdebug' ),
				} )
				.option( 'admin-username', {
					type: 'string',
					description: __( 'Admin username' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					description: __( 'Admin password' ),
				} )
				.option( 'admin-email', {
					type: 'string',
					description: __( 'Admin email' ),
				} )
				.option( 'debug-log', {
					type: 'boolean',
					description: __( 'Enable WP_DEBUG_LOG' ),
				} )
				.option( 'debug-display', {
					type: 'boolean',
					description: __( 'Enable WP_DEBUG_DISPLAY' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, {
					name: argv.name,
					domain: argv.domain,
					https: argv.https,
					php: argv.php,
					wp: argv.wp,
					runtime: siteModeSchema.optional().parse( argv.runtime ),
					fileAccess: siteFileAccessSchema.optional().parse( argv.fileAccess ),
					xdebug: argv.xdebug,
					adminUsername: argv.adminUsername,
					adminPassword: argv.adminPassword,
					adminEmail: argv.adminEmail,
					debugLog: argv.debugLog,
					debugDisplay: argv.debugDisplay,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to configure site' ), error );
					logger.reportError( loggerError );
				}
				process.exit( 1 );
			}
		},
	} );
};
