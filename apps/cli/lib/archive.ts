import fs from 'fs';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { __ } from '@wordpress/i18n';
import { ZipArchive, type ZipEntryData } from 'archiver';
import { glob } from 'glob';
import { readActiveThemes } from 'cli/lib/active-themes';
import { isHostManagedPullFile } from 'cli/lib/pull/pull-session';
import { LoggerError } from 'cli/logger';

const ZIP_COMPRESSION_LEVEL = 9;
// Media and archives are already compressed: deflating them again costs most of the archiving
// time on a media-heavy site and saves almost nothing, so they are stored as they are.
const ALREADY_COMPRESSED_FILE =
	/\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|webm|mp3|m4a|ogg|woff2?|zip|gz|tgz|bz2|xz|7z|rar|pdf)$/i;
const STUDIO_LOADER_ARCHIVE_PATH = `wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`;

// Plugins WordPress.com provides on every Atomic site. Their folders are left out of preview
// archives: WordPress.com's importer keeps its own managed copy and ignores uploaded ones
// (wpcomsh skips any uploaded plugin directory that `/wordpress/plugins/<slug>/latest` covers),
// and activation lives in the database, so the plugin stays active on the preview.
const WORDPRESS_COM_PROVIDED_PLUGINS = new Set( [
	'jetpack',
	'akismet',
	'gutenberg',
	'classic-editor',
	'crowdsignal-forms',
	'gravatar-enhanced',
	'layout-grid',
	'page-optimize',
	'polldaddy',
] );

type ArchiveEntry = {
	// Path inside the archive, e.g. `wp-content/plugins/my-plugin/my-plugin.php`.
	name: string;
	// Real path of the file to read, with symlinks resolved.
	sourcePath: string;
};

/**
 * Lists the files a site's preview archive holds. Inactive themes are left out: they don't change
 * what the preview shows, and the stock default themes alone are most of a small site's archive.
 * Files a pulled site links from its host's managed tree are left out too: the WordPress.com site
 * has them. Plugins WordPress.com provides are left out for the same reason.
 */
async function listArchiveEntries( siteFolder: string ): Promise< ArchiveEntry[] > {
	const deployIgnore = await createDeployIgnoreFilter( siteFolder );
	const activeThemes = await readActiveThemes( siteFolder );
	// Files inside a theme folder (not `themes/index.php`) that belong to no active theme.
	const isInactiveTheme = ( relativePath: string ) =>
		!! activeThemes &&
		/^themes\/[^/]+\//.test( relativePath ) &&
		! [ ...activeThemes ].some( ( theme ) => relativePath.startsWith( `themes/${ theme }/` ) );
	// Files inside a WordPress.com-provided plugin's folder (not `plugins/index.php`).
	const isWordPressComProvidedPlugin = ( relativePath: string ) => {
		const match = relativePath.match( /^plugins\/([^/]+)\// );
		return match !== null && WORDPRESS_COM_PROVIDED_PLUGINS.has( match[ 1 ] );
	};

	// `archiver.directory()` does not follow symlinks, so we enumerate the files
	// with glob ourselves to support symlinked plugins/themes. See
	// https://github.com/archiverjs/node-archiver/pull/810
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const relativePaths = await glob( '**/*', {
		cwd: wpContentPath,
		dot: true,
		follow: true,
		nodir: true,
		// Keep entry names forward-slashed on Windows
		posix: true,
	} );

	const entries: ArchiveEntry[] = [];
	for ( const relativePath of relativePaths ) {
		const name = `wp-content/${ relativePath }`;
		if (
			name === STUDIO_LOADER_ARCHIVE_PATH ||
			deployIgnore.ignores( name ) ||
			isInactiveTheme( relativePath ) ||
			isWordPressComProvidedPlugin( relativePath )
		) {
			continue;
		}
		// If the source path is a symlink, `Archiver.file()` appends a symlink to
		// the archive instead of the target file. We don't want this. By calling
		// realpath first, we ensure the source file data is always appended. This
		// is preferable to passing readable streams to `Archiver.append()`, which
		// can lead to EMFILE errors.
		try {
			const sourcePath = fs.realpathSync( path.join( wpContentPath, relativePath ) );
			if ( ! isHostManagedPullFile( sourcePath ) ) {
				entries.push( { name, sourcePath } );
			}
		} catch ( error ) {
			// Dangling symlink. Skip it rather than aborting the whole archive.
			console.warn( `Skipping ${ name }: ${ error }` );
		}
	}

	const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
	if ( fs.existsSync( wpConfigPath ) ) {
		entries.push( { name: 'wp-config.php', sourcePath: wpConfigPath } );
	}
	return entries;
}

/**
 * Total size of the files a site's preview archive holds, before compression. The size limit
 * applies to this, so files the archive leaves out don't count against it.
 */
export async function getArchiveContentSize( siteFolder: string ): Promise< number > {
	const entries = await listArchiveEntries( siteFolder );
	return entries.reduce( ( total, entry ) => total + fs.statSync( entry.sourcePath ).size, 0 );
}

/** Archives a site for a preview; see `listArchiveEntries` for what it holds. */
export async function archiveSiteContent(
	siteFolder: string,
	archivePath: string
): Promise< ZipArchive > {
	const entries = await listArchiveEntries( siteFolder );

	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		const archiveBuilder = new ZipArchive( {
			zlib: { level: ZIP_COMPRESSION_LEVEL },
		} );

		output.on( 'close', () => {
			resolve( archiveBuilder );
		} );
		archiveBuilder.on( 'error', ( error: Error ) => {
			reject( new LoggerError( __( 'Failed to create archive' ), error ) );
		} );

		archiveBuilder.pipe( output );

		for ( const { name, sourcePath } of entries ) {
			// `file()` passes the zip-only `store` option through, though its types omit it.
			const entry: ZipEntryData = { name, store: ALREADY_COMPRESSED_FILE.test( name ) };
			archiveBuilder.file( sourcePath, entry );
		}

		archiveBuilder.finalize().catch( reject );
	} );
}

export async function cleanup( archivePath: string ): Promise< void > {
	// Wrap the cleanup logic in a setTimeout to avoid race conditions
	return new Promise( ( resolve ) => {
		setTimeout( () => {
			if ( fs.existsSync( archivePath ) ) {
				fs.unlinkSync( archivePath );
			}
			resolve();
		}, 0 );
	} );
}
