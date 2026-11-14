import path from 'path';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { BlueprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SupportedPHPVersions, type SupportedPHPVersion } from '@studio/common/types/php-versions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { loadLibraryBlueprints, openBlueprintSource } from 'cli/lib/blueprint-library';
import { select, input } from 'cli/lib/prompts';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { untildify } from 'cli/lib/utils';
import {
	CLI_AUTO_UPDATE_WP_VERSION,
	coerceWpVersionOption,
	getWpVersionOptionDescription,
} from 'cli/lib/wp-version-option';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	slug: string | undefined,
	options: {
		name?: string;
		wpVersion?: string;
		phpVersion?: SupportedPHPVersion;
		customDomain?: string;
		enableHttps: boolean;
		adminUsername?: string;
		adminPassword?: string;
		adminEmail?: string;
		noStart: boolean;
		skipBrowser: boolean;
	}
): Promise< void > {
	logger.reportStart( LoggerAction.FETCH_BLUEPRINTS, __( 'Fetching blueprints…' ) );
	const blueprints = await loadLibraryBlueprints();

	if ( blueprints.length === 0 ) {
		throw new LoggerError( __( 'No blueprints available' ) );
	}

	logger.reportSuccess(
		sprintf(
			_n( 'Found %d blueprint', 'Found %d blueprints', blueprints.length ),
			blueprints.length
		)
	);

	let selectedSlug = slug;

	if ( ! selectedSlug ) {
		if ( ! process.stdin.isTTY ) {
			throw new LoggerError(
				__(
					'A blueprint slug is required in non-interactive mode. Run "studio blueprint list" to see available slugs.'
				)
			);
		}

		selectedSlug = await select( {
			message: __( 'Select a blueprint:' ),
			choices: blueprints.map( ( bp ) => ( {
				name: `${ bp.title } (${ bp.slug })`,
				value: bp.slug,
			} ) ),
			loop: false,
		} );
	}

	const blueprint = blueprints.find( ( bp ) => bp.slug === selectedSlug );
	if ( ! blueprint ) {
		throw new LoggerError(
			sprintf(
				__( 'Blueprint "%s" not found. Run "studio blueprint list" to see available slugs.' ),
				selectedSlug
			)
		);
	}

	logger.reportStart( LoggerAction.FETCH_BLUEPRINT, __( 'Loading Blueprint…' ) );
	await using opened = await openBlueprintSource( blueprint );
	logger.reportSuccess( __( 'Blueprint loaded' ) );

	await runCreateSiteCommand( sitePath, {
		name: options.name,
		wpVersion: options.wpVersion ?? DEFAULT_WORDPRESS_VERSION,
		phpVersion: options.phpVersion ?? DEFAULT_PHP_VERSION,
		fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
		customDomain: options.customDomain,
		enableHttps: options.enableHttps,
		blueprint: { contents: opened.blueprint, uri: opened.path },
		adminUsername: options.adminUsername,
		adminPassword: options.adminPassword,
		adminEmail: options.adminEmail,
		noStart: options.noStart,
		skipBrowser: options.skipBrowser,
		skipLogDetails: false,
	} );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'use [slug]',
		describe: __( 'Create a site from a blueprint' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'slug', {
					type: 'string',
					description: __( 'Blueprint slug (run "studio blueprint list" to see options)' ),
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: getWpVersionOptionDescription(),
					defaultDescription: CLI_AUTO_UPDATE_WP_VERSION,
					coerce: coerceWpVersionOption,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: SupportedPHPVersions,
					defaultDescription: DEFAULT_PHP_VERSION,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					implies: 'domain',
				} )
				.option( 'admin-username', {
					type: 'string',
					describe: __( 'Admin username' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					describe: __( 'Admin password' ),
				} )
				.option( 'admin-email', {
					type: 'string',
					describe: __( 'Admin email' ),
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} )
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			try {
				let sitePath = argv.path;
				const pathWasExplicitlyProvided = sitePath !== process.cwd();

				if ( ! pathWasExplicitlyProvided && process.stdin.isTTY ) {
					const siteName = argv.name || __( 'My WordPress Website' );
					const suggestedPath = getDefaultSitePath( siteName );
					const promptedPath = await input( {
						message: __( 'Site path:' ),
						default: suggestedPath,
					} );
					sitePath = path.resolve( untildify( promptedPath ) );
				} else if ( ! pathWasExplicitlyProvided ) {
					const siteName = argv.name || argv.slug || 'wordpress-site';
					sitePath = path.resolve( getDefaultSitePath( siteName ) );
				}

				await runCommand( sitePath, argv.slug, {
					name: argv.name,
					wpVersion: argv.wp,
					phpVersion: argv.php,
					customDomain: argv.domain,
					enableHttps: !! argv.https,
					adminUsername: argv.adminUsername,
					adminPassword: argv.adminPassword,
					adminEmail: argv.adminEmail,
					noStart: ! argv.start,
					skipBrowser: !! argv.skipBrowser,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError(
						__( 'Failed to create site from blueprint' ),
						error
					);
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
