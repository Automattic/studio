import { SupportedPHPVersions } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from 'common/constants';
import { getDomainNameValidationError } from 'common/lib/domains';
import { arePathsEqual } from 'common/lib/fs-utils';
import {
	getWordPressVersionUrl,
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from 'common/lib/wordpress-version-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	getSiteByFolder,
	isXdebugBetaEnabled,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { updateDomainInHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { setupCustomDomain } from 'cli/lib/site-utils';
import { validatePhpVersion } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];

const logger = new Logger< LoggerAction >();

export interface SetCommandOptions {
	name?: string;
	domain?: string;
	https?: boolean;
	php?: string;
	wp?: string;
	xdebug?: boolean;
}

export async function runCommand( sitePath: string, options: SetCommandOptions ): Promise< void > {
	const { name, domain, https, php, wp, xdebug } = options;

	if (
		name === undefined &&
		domain === undefined &&
		https === undefined &&
		php === undefined &&
		wp === undefined &&
		xdebug === undefined
	) {
		throw new LoggerError(
			__( 'At least one option (--name, --domain, --https, --php, --wp, --xdebug) is required.' )
		);
	}

	if ( name !== undefined && ! name.trim() ) {
		throw new LoggerError( __( 'Site name cannot be empty.' ) );
	}

	if ( xdebug !== undefined && ! ( await isXdebugBetaEnabled() ) ) {
		throw new LoggerError(
			__( 'Xdebug support is a beta feature. Enable it in Studio settings first.' )
		);
	}

	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		let site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		const initialAppdata = await readAppdata();

		if ( domain !== undefined ) {
			const existingDomainNames = initialAppdata.sites
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
			const otherXdebugSite = initialAppdata.sites.find(
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
		const phpChanged = php !== undefined && php !== site.phpVersion;
		const wpChanged = wp !== undefined;
		const xdebugChanged = xdebug !== undefined && xdebug !== site.enableXdebug;

		const hasChanges =
			nameChanged || domainChanged || httpsChanged || phpChanged || wpChanged || xdebugChanged;
		if ( ! hasChanges ) {
			throw new LoggerError(
				__( 'No changes to apply. The site already has the specified settings.' )
			);
		}

		const needsRestart = domainChanged || httpsChanged || phpChanged || wpChanged || xdebugChanged;
		const oldDomain = site.customDomain;

		try {
			await lockAppdata();
			const appdata = await readAppdata();
			const foundSite = appdata.sites.find( ( s ) => arePathsEqual( s.path, sitePath ) );
			if ( ! foundSite ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}

			if ( nameChanged ) {
				foundSite.name = name!;
			}
			if ( domainChanged ) {
				foundSite.customDomain = domain;
			}
			if ( httpsChanged ) {
				foundSite.enableHttps = https;
			}
			if ( phpChanged ) {
				foundSite.phpVersion = php!;
			}
			if ( xdebugChanged ) {
				foundSite.enableXdebug = xdebug;
			}

			await saveAppdata( appdata );
			site = foundSite;
		} finally {
			await unlockAppdata();
		}

		if ( domainChanged ) {
			logger.reportStart( LoggerAction.ADD_DOMAIN_TO_HOSTS, __( 'Updating hosts file…' ) );
			await updateDomainInHosts( oldDomain, domain, site.port );
			logger.reportSuccess( __( 'Hosts file updated' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const wasRunning = await isServerRunning( site.id );

		if ( needsRestart && wasRunning ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress site stopped' ) );
		}

		if ( wpChanged ) {
			logger.reportStart( LoggerAction.SET_WP_VERSION, __( 'Changing WordPress version…' ) );
			const phpVersion = validatePhpVersion( site.phpVersion );
			const zipUrl = getWordPressVersionUrl( wp );

			// Use the correct site URL to avoid corrupting WordPress URL options
			let siteUrl: string | undefined;
			if ( site.customDomain ) {
				const protocol = site.enableHttps ? 'https' : 'http';
				siteUrl = `${ protocol }://${ site.customDomain }`;
			}

			const [ response, exitPhp ] = await runWpCliCommand( sitePath, phpVersion, [
				'core',
				'update',
				zipUrl,
				'--force',
				'--skip-plugins',
				'--skip-themes',
			] );

			const exitCode = await response.exitCode;
			if ( exitCode !== 0 ) {
				exitPhp();
				throw new LoggerError( sprintf( __( 'Failed to update WordPress version to %s' ), wp ) );
			}
			logger.reportSuccess( __( 'WordPress version changed' ) );

			try {
				await lockAppdata();
				const appdata = await readAppdata();
				const updatedSite = appdata.sites.find( ( s ) => s.id === site.id );
				if ( updatedSite ) {
					updatedSite.isWpAutoUpdating = wp === DEFAULT_WORDPRESS_VERSION;
					await saveAppdata( appdata );
					site = updatedSite;
				}
			} finally {
				await unlockAppdata();
			}

			exitPhp();
		}

		if ( needsRestart && wasRunning ) {
			if ( site.customDomain ) {
				await setupCustomDomain( site, logger, { skipHostsUpdate: true } );
			}

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress site…' ) );
			const processDesc = await startWordPressServer( site, logger );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logger.reportSuccess( __( 'WordPress site started' ) );
		}

		logger.reportSuccess( __( 'Site configuration updated' ) );
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set',
		describe: __( 'Configure site settings' ),
		builder: async ( yargs ) => {
			const showXdebug = await isXdebugBetaEnabled();
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
					choices: ALLOWED_PHP_VERSIONS,
				} )
				.option( 'wp', {
					type: 'string',
					description: __( 'WordPress version' ),
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
				.option( 'xdebug', {
					type: 'boolean',
					description: __( 'Enable Xdebug (beta feature)' ),
					hidden: ! showXdebug,
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
					xdebug: argv.xdebug,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to configure site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
