import fs from 'fs';
import path from 'path';
import {
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
} from '@studio/common/lib/site-file-access';
import {
	frontendCreateFrameworkSchema,
	siteFrontendApiSchema,
} from '@studio/common/lib/site-frontend';
import { RecommendedPHPVersion, SupportedPHPVersions } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { isUrl } from 'cli/lib/static-site-import/source';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import {
	CLI_AUTO_UPDATE_WP_VERSION,
	coerceWpVersionOption,
	getWpVersionOptionDescription,
} from 'cli/lib/wp-version-option';
import { StudioArgv } from 'cli/types';
import type { liberateWebsite } from 'cli/lib/data-liberation-client';

function coerceSiteId( value: string ) {
	// Validate UUID format (8-4-4-4-12 hex characters)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if ( ! uuidRegex.test( value ) ) {
		throw new ValidationError( 'id', value, __( 'Must be a valid UUID' ) );
	}
	return value;
}

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.option( 'id', {
			type: 'string',
			describe: __( 'Site ID (UUID format, used internally by Studio app)' ),
			hidden: true,
			coerce: coerceSiteId,
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
			defaultDescription: RecommendedPHPVersion,
		} )
		.option( 'file-access', {
			type: 'string',
			describe: __( 'Which files PHP can access: the site directory only, or all files' ),
			choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ] as const,
			default: SITE_FILE_ACCESS_SITE_DIRECTORY,
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
		.option( 'blueprint', {
			type: 'string',
			describe: __( 'Path or URL to Blueprint JSON file' ),
		} )
		.option( 'from', {
			type: 'string',
			describe: __( 'Create the site from a static import source' ),
			conflicts: 'blueprint',
			coerce: ( value ) => {
				if ( isUrl( value ) ) {
					return value;
				}

				return path.resolve( untildify( value ) );
			},
		} )
		.option( 'keep-source', {
			type: 'boolean',
			describe: __(
				'Keep the Data Liberation source capture at the sibling <site>-source directory when importing from a URL'
			),
			implies: 'from',
		} )
		.option( 'static-site-importer-url', {
			type: 'string',
			describe: __( 'Static Site Importer plugin zip URL for --from imports' ),
			defaultDescription: __( 'the newest Static Site Importer release' ),
			conflicts: 'static-site-importer-path',
		} )
		.option( 'static-site-importer-path', {
			type: 'string',
			describe: __(
				'Local Static Site Importer plugin zip for --from imports, including a paired build from the importer’s build:dev-package'
			),
			conflicts: 'static-site-importer-url',
			coerce: ( value ) => {
				const pluginPath = path.resolve( untildify( value ) );
				if ( path.extname( pluginPath ).toLowerCase() !== '.zip' ) {
					throw new ValidationError(
						'static-site-importer-path',
						value,
						__( 'Must be a .zip file' )
					);
				}
				try {
					if ( ! fs.statSync( pluginPath ).isFile() ) {
						throw new Error();
					}
				} catch {
					throw new ValidationError(
						'static-site-importer-path',
						value,
						__( 'Must be an existing regular .zip file' )
					);
				}
				return pluginPath;
			},
		} )
		.option( 'frontend', {
			type: 'string',
			describe: __(
				'Create a headless site: WordPress plus a frontend project (static HTML, Astro or Next.js) that Studio runs next to it'
			),
			choices: frontendCreateFrameworkSchema.options,
			conflicts: 'from',
		} )
		.option( 'frontend-api', {
			type: 'string',
			describe: __( 'The WordPress API the frontend template reads from (with --frontend)' ),
			choices: siteFrontendApiSchema.options,
			default: 'rest' as const,
		} )
		.option( 'original-blueprint-path', {
			type: 'string',
			hidden: true,
		} )
		.option( 'admin-username', {
			type: 'string',
			describe: __( 'Admin username (defaults to "admin")' ),
		} )
		.option( 'admin-password', {
			type: 'string',
			describe: __(
				'Admin password (auto-generated if not provided). Note: passwords in CLI arguments may be visible in process lists; consider using a Blueprint file for sensitive passwords.'
			),
		} )
		.option( 'admin-email', {
			type: 'string',
			describe: __( 'Admin email (defaults to "admin@localhost.com")' ),
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
		} )
		.option( 'skip-log-details', {
			type: 'boolean',
			describe: __( 'Skip printing site URL and admin credentials after creating' ),
			default: false,
		} )
		.option( 'flow-type', {
			// Internal telemetry hint for the `studio_site_created` Tracks event, set by the
			// desktop app when it spawns the CLI. Hidden from `--help`.
			type: 'string',
			hidden: true,
		} )
		.check( ( argv ) => {
			if ( argv.keepSource && ( ! argv.from || ! isUrl( argv.from ) ) ) {
				throw new Error( __( '--keep-source requires --from with an HTTP(S) URL' ) );
			}
			return true;
		} );
};

export const registerCommand = (
	yargs: StudioArgv,
	dependencies: { liberate?: typeof liberateWebsite } = {}
) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/create' );
			return commandHandler( argv, dependencies );
		},
	} );
};
