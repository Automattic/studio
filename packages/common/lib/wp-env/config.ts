/**
 * Parsing and resolution for `.wp-env.json` project configuration, shared by
 * the CLI (site creation/start) and the desktop app's main process (folder
 * validation for the create-site forms).
 *
 * Reads and merges `.wp-env.json` and `.wp-env.override.json` from a project
 * folder, following wp-env's merge semantics: scalar and array fields are
 * replaced by later layers, while the `config` and `mappings` objects merge
 * per key. The `env.development` overrides are applied last; `env.tests` is
 * out of scope for Studio and reported as a warning.
 *
 * See https://github.com/WordPress/gutenberg/tree/trunk/packages/env#wp-envjson
 */
import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { isValidWordPressVersion } from '@studio/common/lib/wordpress-version-utils';

export const WP_ENV_FILE = '.wp-env.json';
export const WP_ENV_OVERRIDE_FILE = '.wp-env.override.json';

export class WpEnvError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'WpEnvError';
	}
}

const configValueSchema = z.union( [ z.string(), z.number(), z.boolean(), z.null() ] );

const environmentFieldsSchema = z.looseObject( {
	core: z.string().nullable().optional(),
	phpVersion: z.string().nullable().optional(),
	plugins: z.array( z.string() ).optional(),
	themes: z.array( z.string() ).optional(),
	port: z.number().optional(),
	config: z.record( z.string(), configValueSchema ).optional(),
	mappings: z.record( z.string(), z.string() ).optional(),
} );

const wpEnvFileSchema = environmentFieldsSchema.extend( {
	env: z
		.looseObject( {
			development: environmentFieldsSchema.optional(),
			tests: z.looseObject( {} ).optional(),
		} )
		.optional(),
} );

export type WpEnvConfig = z.infer< typeof environmentFieldsSchema >;
type WpEnvFileConfig = z.infer< typeof wpEnvFileSchema >;

/**
 * wp-env fields that Studio does not support. They are ignored with a warning
 * rather than failing the whole config.
 */
const UNSUPPORTED_FIELDS = [
	'multisite',
	'mysqlPort',
	'phpmyadmin',
	'phpmyadminPort',
	'testsPort',
	'testsEnvironment',
	'autoPort',
	'lifecycleScripts',
] as const;

export function hasWpEnvConfig( projectDir: string ): boolean {
	return fs.existsSync( path.join( projectDir, WP_ENV_FILE ) );
}

function readWpEnvFile( filePath: string ): WpEnvFileConfig {
	let raw: unknown;
	try {
		raw = JSON.parse( fs.readFileSync( filePath, 'utf-8' ) );
	} catch {
		throw new WpEnvError(
			sprintf(
				/* translators: %s: path to the wp-env config file */
				__( 'Failed to parse %s: invalid JSON' ),
				filePath
			)
		);
	}

	const parsed = wpEnvFileSchema.safeParse( raw );
	if ( ! parsed.success ) {
		throw new WpEnvError(
			sprintf(
				/* translators: %s: path to the wp-env config file */
				__( 'Invalid wp-env configuration in %s' ),
				filePath
			)
		);
	}
	return parsed.data;
}

/**
 * wp-env merge rule: later layers replace earlier fields, except `config` and
 * `mappings`, which merge per key.
 */
function mergeEnvironmentFields( base: WpEnvConfig, overlay: WpEnvConfig ): WpEnvConfig {
	return {
		...base,
		...overlay,
		config: { ...base.config, ...overlay.config },
		mappings: { ...base.mappings, ...overlay.mappings },
	};
}

function collectUnsupportedFieldWarnings( config: WpEnvFileConfig, warnings: string[] ): void {
	for ( const field of UNSUPPORTED_FIELDS ) {
		if ( field in config ) {
			warnings.push(
				sprintf(
					/* translators: %s: name of the unsupported wp-env field */
					__( 'The wp-env "%s" option is not supported by Studio and will be ignored.' ),
					field
				)
			);
		}
	}
	if ( config.env?.tests ) {
		warnings.push(
			__( 'The wp-env "env.tests" environment is not supported by Studio and will be ignored.' )
		);
	}
}

export interface LoadedWpEnvConfig {
	config: WpEnvConfig;
	warnings: string[];
}

/**
 * Loads the effective development-environment config for a project folder, or
 * `undefined` when the folder has no `.wp-env.json`.
 */
export function loadWpEnvConfig( projectDir: string ): LoadedWpEnvConfig | undefined {
	const configPath = path.join( projectDir, WP_ENV_FILE );
	if ( ! fs.existsSync( configPath ) ) {
		return undefined;
	}

	const warnings: string[] = [];
	const base = readWpEnvFile( configPath );
	collectUnsupportedFieldWarnings( base, warnings );

	let merged: WpEnvFileConfig = base;
	const overridePath = path.join( projectDir, WP_ENV_OVERRIDE_FILE );
	if ( fs.existsSync( overridePath ) ) {
		const override = readWpEnvFile( overridePath );
		collectUnsupportedFieldWarnings( override, warnings );
		merged = {
			...mergeEnvironmentFields( base, override ),
			env: {
				development: mergeEnvironmentFields(
					base.env?.development ?? {},
					override.env?.development ?? {}
				),
			},
		};
	}

	const development = merged.env?.development;
	const config = development ? mergeEnvironmentFields( merged, development ) : merged;
	// `env` is a file-level construct, not part of the effective config.
	delete ( config as WpEnvFileConfig ).env;

	return { config, warnings };
}

/** wp-env details of a folder, surfaced by the create-site forms. */
export interface WpEnvFolderInfo {
	/** The resolved Studio version from the file's `core` (e.g. 'nightly'). */
	wpVersion: string;
	phpVersion?: string;
}

/**
 * Tolerant wp-env detection for folder validation: an invalid or unsupported
 * project file yields `undefined` so the form behaves normally and site
 * creation surfaces the actual error.
 */
export function detectWpEnvFolder( folderPath: string ): WpEnvFolderInfo | undefined {
	try {
		if ( ! hasWpEnvConfig( folderPath ) ) {
			return undefined;
		}
		const loaded = loadWpEnvConfig( folderPath );
		return {
			wpVersion: resolveWpEnvCoreVersion( loaded?.config.core ?? null, [] ) ?? 'latest',
			phpVersion: loaded?.config.phpVersion ?? undefined,
		};
	} catch {
		return undefined;
	}
}

/** Whether a wp-env source string refers to a local path. */
export function isWpEnvLocalSource( source: string ): boolean {
	return (
		source === '.' ||
		source.startsWith( './' ) ||
		source.startsWith( '../' ) ||
		source.startsWith( '~' ) ||
		path.isAbsolute( source ) ||
		// Windows-style relative paths.
		source.startsWith( '.\\' ) ||
		source.startsWith( '..\\' )
	);
}

const GITHUB_SOURCE_PATTERN = /^([^/]+)\/([^#/]+)(\/[^#]+)?(?:#(.+))?$/;
const ZIP_SOURCE_PATTERN = /^https?:\/\/[^\s$.?#].[^\s]*\.zip(\?.+)?$/;
const WP_ORG_RELEASE_ZIP_PATTERN =
	/^https?:\/\/(?:www\.)?wordpress\.org\/wordpress-([^/]+)\.zip(\?.+)?$/;
const WP_ORG_NIGHTLY_ZIP_PATTERN =
	/^https?:\/\/(?:www\.)?wordpress\.org\/nightly-builds\/wordpress-latest\.zip(\?.+)?$/;

/**
 * Resolves a wp-env `core` source to a Studio WordPress version string.
 *
 * - `null`/absent → undefined (caller defaults to the latest release).
 * - `WordPress/WordPress` (optionally `#master`/`#trunk`) means core trunk;
 *   the closest Studio equivalent is `nightly` (built daily from trunk) —
 *   resolved with a warning.
 * - `WordPress/WordPress#<release tag>` → that version.
 * - wordpress.org release/nightly zip URLs → the corresponding version.
 * - Everything else (local core checkouts, forks, arbitrary refs, other
 *   hosts) is not supported and throws.
 */
export function resolveWpEnvCoreVersion(
	core: string | null | undefined,
	warnings: string[]
): string | undefined {
	if ( core == null ) {
		return undefined;
	}

	const unsupported = ( reason: string ) =>
		new WpEnvError(
			sprintf(
				/* translators: %1$s: the wp-env core value, %2$s: the reason it is unsupported */
				__( 'The wp-env "core" value "%1$s" is not supported yet by Studio (%2$s).' ),
				core,
				reason
			)
		);

	if ( isWpEnvLocalSource( core ) ) {
		throw unsupported( __( 'local WordPress checkouts cannot be used as core' ) );
	}

	if ( ZIP_SOURCE_PATTERN.test( core ) ) {
		if ( WP_ORG_NIGHTLY_ZIP_PATTERN.test( core ) ) {
			return 'nightly';
		}
		const releaseMatch = core.match( WP_ORG_RELEASE_ZIP_PATTERN );
		if ( releaseMatch && isValidWordPressVersion( releaseMatch[ 1 ] ) ) {
			return releaseMatch[ 1 ];
		}
		throw unsupported( __( 'only wordpress.org release and nightly zips are recognized' ) );
	}

	if ( core.startsWith( 'ssh:' ) || core.startsWith( 'git+ssh:' ) ) {
		throw unsupported( __( 'git sources cannot be downloaded' ) );
	}

	const githubMatch = core.match( GITHUB_SOURCE_PATTERN );
	if ( ! githubMatch ) {
		throw unsupported( __( 'unrecognized source format' ) );
	}
	const [ , owner, repo, subdirectory, ref ] = githubMatch;
	if ( owner !== 'WordPress' || repo !== 'WordPress' || subdirectory ) {
		throw unsupported( __( 'only the WordPress/WordPress repository is recognized' ) );
	}

	if ( ref === undefined || ref === 'master' || ref === 'trunk' ) {
		warnings.push(
			sprintf(
				/* translators: %s: the wp-env core value */
				__(
					'The wp-env core "%s" refers to WordPress trunk; using the nightly build as the closest equivalent.'
				),
				core
			)
		);
		return 'nightly';
	}

	const version = ref.replace( /^v/, '' );
	if ( isValidWordPressVersion( version ) && version !== 'latest' && version !== 'nightly' ) {
		return version;
	}

	throw unsupported( __( 'only release tags, "master", and "trunk" refs are recognized' ) );
}
