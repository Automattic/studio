/**
 * Turns a project's `.wp-env.json` into ready-to-use server start options.
 *
 * `wpEnvToSiteConfig()` is the single entry point: it loads the wp-env
 * config, exposes the project's plugins/themes/mappings inside the site
 * directory, and returns start options assignable to the CLI's
 * `StartServerOptions` — mirroring how `cli/lib/pull/runtime-start-options`
 * computes options for imported sites.
 *
 * Both runtimes share the same shape: WordPress core lives in the site
 * directory (`site.path`) and the project's folders are exposed inside
 * `wp-content` without being copied:
 * - Playground sandbox: core is installed by Playground into the (initially
 *   empty) site directory, and content links become VFS mounts under
 *   `/wordpress`.
 * - Native PHP: content links become symlinks (junctions on Windows) inside
 *   the site directory; php-server-child's existing symlink handling extends
 *   `open_basedir` to the link targets. IMPORTANT: core (and Studio's SQLite
 *   integration) must already be in the site directory before calling — links
 *   into `wp-content` are created on disk, and copying core afterwards would
 *   write through them into the user's project.
 *
 * Phase 1 scope: local path sources only. Remote sources (GitHub slugs, zip
 * URLs, SSH repos) and a custom `core` are rejected with a clear error.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { SITE_RUNTIME_NATIVE_PHP, type SiteRuntime } from '@studio/common/lib/site-runtime';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import {
	isWpEnvLocalSource,
	loadWpEnvConfig,
	resolveWpEnvCoreVersion,
	WpEnvError,
	type WpEnvConfig,
} from '@studio/common/lib/wp-env/config';
import { SupportedPHPVersions, type SupportedPHPVersion } from '@studio/common/types/php-versions';

/**
 * A host folder to expose inside the WordPress root. `contentPath` is
 * relative to the WordPress root and always uses forward slashes (it doubles
 * as a Playground VFS path segment).
 */
interface ContentLink {
	hostPath: string;
	contentPath: string;
}

/**
 * Start options computed from the project file, structurally assignable to
 * the CLI's `StartServerOptions`.
 */
export interface WpEnvStartOptions {
	mounts?: Array< { hostPath: string; vfsPath: string } >;
	blueprint?: { steps: unknown[] };
	blueprintUri?: string;
}

export interface WpEnvSiteConfig {
	/** Assignable to the CLI's `StartServerOptions` for `startWordPressServer()`. */
	startOptions: WpEnvStartOptions;
	/** From wp-env's `phpVersion`; belongs on `SiteData`, not start options. */
	phpVersion?: SupportedPHPVersion;
	/** From wp-env's `port`; a preference for the port finder. */
	preferredPort?: number;
	/**
	 * From wp-env's `core`, resolved to a Studio WordPress version string
	 * (e.g. 'latest', 'nightly', '6.4.2'). Undefined when `core` is null.
	 */
	wpVersion?: string;
	warnings: string[];
}

/**
 * wp-config constants that Studio manages itself (debug flags via site
 * settings, URLs via the assigned port / custom domain, DB via SQLite).
 * User-provided values would either be clobbered or fight the runtime.
 */
const STUDIO_MANAGED_CONSTANTS = [
	'DB_NAME',
	'WP_DEBUG',
	'WP_DEBUG_LOG',
	'WP_DEBUG_DISPLAY',
	'WP_HOME',
	'WP_SITEURL',
];

const BLUEPRINT_FILENAME = '.wp-env-blueprint.json';

/**
 * The `~/.studio/wp-env/<siteId>` directory holding the WordPress install a
 * wp-env project site runs from (its `technicalSiteDirectory`). Keyed by
 * `siteId` so it follows the site, mirroring reprint's pulls directory.
 */
export function getWpEnvCoreDirectory( siteId: string ): string {
	return path.join( getConfigDirectory(), 'wp-env', siteId );
}

/**
 * Computes the start options for a project folder containing `.wp-env.json`,
 * or `undefined` when the project has none. See the module doc for the
 * runtime-specific behavior and ordering requirements.
 */
export async function wpEnvToSiteConfig(
	projectDir: string,
	siteDir: string,
	runtime: SiteRuntime
): Promise< WpEnvSiteConfig | undefined > {
	const loaded = loadWpEnvConfig( projectDir );
	if ( ! loaded ) {
		return undefined;
	}
	const { config, warnings } = loaded;

	const wpVersion = resolveWpEnvCoreVersion( config.core, warnings );

	const contentLinks = collectContentLinks( projectDir, config );
	const blueprintSteps = buildBlueprintSteps( projectDir, config, warnings );

	const startOptions: WpEnvStartOptions =
		runtime === SITE_RUNTIME_NATIVE_PHP
			? await materializeNativeContentLinks( siteDir, contentLinks )
			: sandboxStartOptions( siteDir, contentLinks );

	if ( blueprintSteps.length > 0 ) {
		// The blueprint file anchors relative resource resolution and gives the
		// native runtime's blueprints.phar a real path; the site directory is
		// Studio-owned and writable on both runtimes.
		const blueprintUri = path.join( siteDir, BLUEPRINT_FILENAME );
		const blueprint = { steps: blueprintSteps };
		await fs.promises.mkdir( siteDir, { recursive: true } );
		await fs.promises.writeFile( blueprintUri, JSON.stringify( blueprint, null, 2 ) );
		startOptions.blueprint = blueprint;
		startOptions.blueprintUri = blueprintUri;
	}

	return {
		startOptions,
		phpVersion: config.phpVersion != null ? validatePhpVersion( config.phpVersion ) : undefined,
		preferredPort: config.port ?? undefined,
		wpVersion,
		warnings,
	};
}

function collectContentLinks( projectDir: string, config: WpEnvConfig ): ContentLink[] {
	const links: ContentLink[] = [];

	for ( const source of config.plugins ?? [] ) {
		const hostPath = assertLocalDirectory( projectDir, source, 'plugins' );
		links.push( { hostPath, contentPath: `wp-content/plugins/${ path.basename( hostPath ) }` } );
	}

	for ( const source of config.themes ?? [] ) {
		const hostPath = assertLocalDirectory( projectDir, source, 'themes' );
		// wp-env installs themes without activating them; activation persists in
		// the database once the user does it.
		links.push( { hostPath, contentPath: `wp-content/themes/${ path.basename( hostPath ) }` } );
	}

	for ( const [ destination, source ] of Object.entries( config.mappings ?? {} ) ) {
		const hostPath = assertLocalDirectory( projectDir, source, 'mappings' );
		links.push( { hostPath, contentPath: normalizeContentPath( destination ) } );
	}

	return links;
}

function buildBlueprintSteps(
	projectDir: string,
	config: WpEnvConfig,
	warnings: string[]
): Array< Record< string, unknown > > {
	const steps: Array< Record< string, unknown > > = [];

	for ( const source of config.plugins ?? [] ) {
		const hostPath = assertLocalDirectory( projectDir, source, 'plugins' );
		const slug = path.basename( hostPath );
		const mainFile = findPluginMainFile( hostPath );
		if ( mainFile ) {
			// Relative-to-plugins-dir paths work on both runtimes (Playground's
			// activatePlugin and blueprints.phar).
			steps.push( { step: 'activatePlugin', pluginPath: `${ slug }/${ mainFile }` } );
		} else {
			warnings.push(
				sprintf(
					/* translators: %s: path to the plugin directory */
					__(
						'No main plugin file (with a "Plugin Name:" header) found in %s. The plugin is linked but not activated.'
					),
					hostPath
				)
			);
		}
	}

	const constants: Record< string, string | number | boolean > = {};
	for ( const [ key, value ] of Object.entries( config.config ?? {} ) ) {
		if ( STUDIO_MANAGED_CONSTANTS.includes( key ) ) {
			warnings.push(
				sprintf(
					/* translators: %s: the wp-config constant name */
					__( 'The wp-env config constant "%s" is managed by Studio and will be ignored.' ),
					key
				)
			);
			continue;
		}
		if ( value === null ) {
			// wp-env uses null to prevent a constant from being defined; Studio
			// doesn't define extra constants by default, so there is nothing to do.
			continue;
		}
		constants[ key ] = value;
	}
	if ( Object.keys( constants ).length > 0 ) {
		steps.push( { step: 'defineWpConfigConsts', consts: constants } );
	}

	return steps;
}

/**
 * Sandbox: content links ride in as VFS mounts on top of the site directory
 * (mounted at `/wordpress`). Install mode is left to the server child's
 * auto-detection. Mirrors the native merge semantics: a VFS mount shadows the
 * whole destination directory, so when the destination already exists in the
 * site (e.g. `wp-content/mu-plugins` holding Studio's SQLite integration),
 * the host folder's children are mounted individually instead — replacing the
 * dir would hide Studio's files and break the site.
 */
function sandboxStartOptions( siteDir: string, contentLinks: ContentLink[] ): WpEnvStartOptions {
	const mounts: NonNullable< WpEnvStartOptions[ 'mounts' ] > = [];
	for ( const link of contentLinks ) {
		const destination = path.join( siteDir, ...link.contentPath.split( '/' ) );
		if ( fs.existsSync( destination ) && fs.statSync( destination ).isDirectory() ) {
			for ( const entry of fs.readdirSync( link.hostPath ) ) {
				mounts.push( {
					hostPath: path.join( link.hostPath, entry ),
					vfsPath: `/wordpress/${ link.contentPath }/${ entry }`,
				} );
			}
		} else {
			mounts.push( {
				hostPath: link.hostPath,
				vfsPath: `/wordpress/${ link.contentPath }`,
			} );
		}
	}
	return { mounts };
}

/**
 * Native PHP: creates the content links as symlinks inside the site
 * directory. Idempotent: existing links pointing at the right target are kept
 * and links pointing elsewhere are replaced. When the destination is an
 * existing real directory (e.g. `wp-content/mu-plugins`, which holds Studio's
 * SQLite integration), the host folder's children are merged into it instead
 * of replacing it. A destination occupied by a real file is an error.
 */
async function materializeNativeContentLinks(
	siteDir: string,
	contentLinks: ContentLink[]
): Promise< WpEnvStartOptions > {
	for ( const link of contentLinks ) {
		await linkIntoSite( link.hostPath, path.join( siteDir, ...link.contentPath.split( '/' ) ) );
	}
	return {};
}

async function linkIntoSite( hostPath: string, linkPath: string ): Promise< void > {
	await fs.promises.mkdir( path.dirname( linkPath ), { recursive: true } );

	const stat = await fs.promises.lstat( linkPath ).catch( () => undefined );
	if ( stat?.isSymbolicLink() ) {
		const currentTarget = await fs.promises.readlink( linkPath );
		if ( path.resolve( path.dirname( linkPath ), currentTarget ) === hostPath ) {
			return;
		}
		await fs.promises.unlink( linkPath );
	} else if ( stat?.isDirectory() ) {
		// The destination already exists in the site (e.g. `wp-content/mu-plugins`
		// holds Studio's SQLite integration). Replacing it would break the site,
		// so merge instead: link the host folder's children into it.
		const entries = await fs.promises.readdir( hostPath );
		for ( const entry of entries ) {
			await linkIntoSite( path.join( hostPath, entry ), path.join( linkPath, entry ) );
		}
		return;
	} else if ( stat ) {
		throw new WpEnvError(
			sprintf(
				/* translators: %1$s: path inside the site directory, %2$s: the project path it should link to */
				__( 'Cannot link %1$s to %2$s: the destination already exists in the site directory.' ),
				linkPath,
				hostPath
			)
		);
	}

	const hostIsDirectory = ( await fs.promises.stat( hostPath ) ).isDirectory();
	// Junctions work on Windows without developer mode or admin rights, but
	// only for directories; file links fall back to regular symlinks.
	const linkType = ! hostIsDirectory ? 'file' : process.platform === 'win32' ? 'junction' : 'dir';
	await fs.promises.symlink( hostPath, linkPath, linkType );
}

function untildify( input: string ): string {
	return input.startsWith( '~' ) ? path.join( os.homedir(), input.slice( 1 ) ) : input;
}

function assertLocalDirectory( projectDir: string, source: string, field: string ): string {
	if ( ! isWpEnvLocalSource( source ) ) {
		throw new WpEnvError(
			sprintf(
				/* translators: %1$s: wp-env field name, %2$s: the source value */
				__(
					'Remote wp-env sources are not supported yet by Studio (%1$s: "%2$s"). Use a local path.'
				),
				field,
				source
			)
		);
	}
	const resolved = path.resolve( projectDir, untildify( source ) );
	if ( ! fs.existsSync( resolved ) || ! fs.statSync( resolved ).isDirectory() ) {
		throw new WpEnvError(
			sprintf(
				/* translators: %1$s: wp-env field name, %2$s: the resolved path */
				__( 'The wp-env %1$s path does not exist or is not a directory: %2$s' ),
				field,
				resolved
			)
		);
	}
	return resolved;
}

/**
 * Finds the main plugin file (the one with a "Plugin Name:" header) at the
 * root of a plugin directory, mirroring WordPress's own detection: headers
 * must appear within the first 8 KB of the file.
 */
function findPluginMainFile( pluginDir: string ): string | undefined {
	const HEADER_SEARCH_BYTES = 8192;
	const phpFiles = fs
		.readdirSync( pluginDir )
		.filter( ( entry ) => entry.toLowerCase().endsWith( '.php' ) )
		.sort();

	for ( const entry of phpFiles ) {
		const filePath = path.join( pluginDir, entry );
		if ( ! fs.statSync( filePath ).isFile() ) {
			continue;
		}
		const fd = fs.openSync( filePath, 'r' );
		try {
			const buffer = Buffer.alloc( HEADER_SEARCH_BYTES );
			const bytesRead = fs.readSync( fd, buffer, 0, HEADER_SEARCH_BYTES, 0 );
			const head = buffer.toString( 'utf-8', 0, bytesRead );
			if ( /^[ \t/*#@]*Plugin Name\s*:/im.test( head ) ) {
				return entry;
			}
		} finally {
			fs.closeSync( fd );
		}
	}
	return undefined;
}

function validatePhpVersion( phpVersion: string ): SupportedPHPVersion {
	const supported = SupportedPHPVersions.find( ( version ) => version === phpVersion );
	if ( ! supported ) {
		throw new WpEnvError(
			sprintf(
				/* translators: %1$s: the requested PHP version, %2$s: list of supported versions */
				__( 'The wp-env PHP version "%1$s" is not supported by Studio. Supported versions: %2$s' ),
				phpVersion,
				SupportedPHPVersions.join( ', ' )
			)
		);
	}
	return supported;
}

/** Normalizes a `mappings` key into a WP-root-relative forward-slash path. */
function normalizeContentPath( mappingKey: string ): string {
	const normalized = mappingKey.replace( /\\/g, '/' ).replace( /^\/+/, '' ).replace( /\/+$/, '' );
	if (
		! normalized ||
		normalized.split( '/' ).some( ( segment ) => segment === '..' || segment === '.' )
	) {
		throw new WpEnvError(
			sprintf(
				/* translators: %s: the wp-env mappings key */
				__( 'Invalid wp-env mappings destination: "%s"' ),
				mappingKey
			)
		);
	}
	return normalized;
}
