import fs from 'fs';
import path from 'path';
import { select, input } from '@inquirer/prompts';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	createBlueprintTempDir,
	downloadAndExtractBlueprintBundle,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { isOnline } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { fetchStudioBlueprints, type Blueprint } from '@studio/common/lib/studio-blueprints-api';
import { BlueprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SupportedPHPVersions, type SupportedPHPVersion } from '@studio/common/types/php-versions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

async function resolveBlueprint( blueprint: Blueprint ): Promise< {
	contents: unknown;
	uri: string;
	tempDir?: string;
} > {
	if ( blueprint.bundle_url ) {
		logger.reportStart( LoggerAction.DOWNLOAD_BUNDLE, __( 'Downloading blueprint bundle…' ) );
		const { blueprintJsonPath, tempDir } = await downloadAndExtractBlueprintBundle(
			blueprint.bundle_url
		);
		const fileContents = await fs.promises.readFile( blueprintJsonPath, 'utf-8' );
		const contents = JSON.parse( fileContents );
		logger.reportSuccess( __( 'Blueprint bundle downloaded' ) );
		return { contents, uri: blueprintJsonPath, tempDir };
	}

	// Write blueprint JSON to temp file so resource paths can be resolved
	const tempDir = await createBlueprintTempDir();
	const tempFile = path.join( tempDir, 'blueprint.json' );
	await fs.promises.writeFile( tempFile, JSON.stringify( blueprint.blueprint ) );
	return { contents: blueprint.blueprint, uri: tempFile, tempDir };
}

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
	if ( ! ( await isOnline() ) ) {
		throw new LoggerError( __( 'An internet connection is required to use blueprints.' ) );
	}

	logger.reportStart( LoggerAction.FETCH_BLUEPRINTS, __( 'Fetching blueprints…' ) );

	const sharedConfig = await readSharedConfig();
	const locale = sharedConfig.locale;
	const blueprints = await fetchStudioBlueprints( locale );

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

	let tempDir: string | undefined;

	try {
		const resolved = await resolveBlueprint( blueprint );
		tempDir = resolved.tempDir;

		await runCreateSiteCommand( sitePath, {
			name: options.name,
			wpVersion: options.wpVersion ?? DEFAULT_WORDPRESS_VERSION,
			phpVersion: options.phpVersion ?? DEFAULT_PHP_VERSION,
			runtime: SITE_RUNTIME_NATIVE_PHP,
			fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			blueprint: {
				contents: resolved.contents,
				uri: resolved.uri,
			},
			adminUsername: options.adminUsername,
			adminPassword: options.adminPassword,
			adminEmail: options.adminEmail,
			noStart: options.noStart,
			skipBrowser: options.skipBrowser,
			skipLogDetails: false,
		} );
	} finally {
		if ( tempDir ) {
			await removeBlueprintTempDir( tempDir ).catch( () => {} );
		}
	}
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
					describe: __( 'WordPress version' ),
					defaultDescription: DEFAULT_WORDPRESS_VERSION,
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
