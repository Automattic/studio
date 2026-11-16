import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { readActiveThemes } from 'cli/lib/active-themes';

const DEFAULT_THEME_PATTERN = /^twentytwenty[a-z]*$/;

/**
 * The names of the active default themes (Twenty Twenty-Five and the like) whose files a site has
 * edited.
 *
 * WordPress.com keeps its own copy of the default themes and uses it instead of an uploaded one,
 * so edits to a default theme's files don't reach a preview. A theme counts as edited when one of
 * its files matches no stock copy of the same version among the WordPress versions Studio has
 * downloaded. Each file can match a different copy: WordPress releases bump a theme's "Tested up
 * to" without bumping its version. Themes Studio has no stock copy of are skipped, so this never
 * reports a theme it can't check.
 */
export async function findEditedDefaultThemes(
	siteFolder: string,
	wordPressVersionsPath = path.join( getServerFilesPath(), 'wordpress-versions' )
): Promise< string[] > {
	const activeThemes = await readActiveThemes( siteFolder );
	if ( ! activeThemes ) {
		return [];
	}

	const edited: string[] = [];
	for ( const slug of [ ...activeThemes ].sort() ) {
		if ( ! DEFAULT_THEME_PATTERN.test( slug ) ) {
			continue;
		}
		const themePath = path.join( siteFolder, 'wp-content', 'themes', slug );
		const version = readThemeVersion( themePath );
		const stockPaths = version ? findStockThemes( wordPressVersionsPath, slug, version ) : [];
		if ( stockPaths.length > 0 && ! matchesStockThemes( themePath, stockPaths ) ) {
			edited.push( readThemeHeader( themePath, 'Theme Name' ) ?? slug );
		}
	}
	return edited;
}

function readThemeVersion( themePath: string ): string | null {
	return readThemeHeader( themePath, 'Version' );
}

function readThemeHeader( themePath: string, header: string ): string | null {
	try {
		const styleCss = fs.readFileSync( path.join( themePath, 'style.css' ), 'utf8' );
		return (
			new RegExp( `^[ \\t/*#@]*${ header }:\\s*(.+?)\\s*$`, 'im' ).exec( styleCss )?.[ 1 ] ?? null
		);
	} catch {
		return null;
	}
}

// The copies of the theme at this version in the WordPress versions Studio has downloaded.
function findStockThemes( wordPressVersionsPath: string, slug: string, version: string ) {
	let wordPressVersions: string[];
	try {
		wordPressVersions = fs.readdirSync( wordPressVersionsPath );
	} catch {
		return [];
	}
	return wordPressVersions
		.map( ( wordPressVersion ) =>
			path.join( wordPressVersionsPath, wordPressVersion, 'wp-content', 'themes', slug )
		)
		.filter( ( stockPath ) => readThemeVersion( stockPath ) === version );
}

// Whether every file of the site's theme is unchanged in one of the stock copies. Dotfiles are
// ignored.
function matchesStockThemes( themePath: string, stockPaths: string[] ): boolean {
	const relativePaths = fs.readdirSync( themePath, { recursive: true, encoding: 'utf8' } );
	for ( const relativePath of relativePaths ) {
		if ( relativePath.split( path.sep ).some( ( part ) => part.startsWith( '.' ) ) ) {
			continue;
		}
		const filePath = path.join( themePath, relativePath );
		const stat = fs.statSync( filePath );
		if ( ! stat.isFile() ) {
			continue;
		}
		const hash = hashFile( filePath );
		const matchesSomeCopy = stockPaths.some( ( stockPath ) => {
			const stockFilePath = path.join( stockPath, relativePath );
			const stockStat = fs.statSync( stockFilePath, { throwIfNoEntry: false } );
			return (
				stockStat?.isFile() && stockStat.size === stat.size && hashFile( stockFilePath ) === hash
			);
		} );
		if ( ! matchesSomeCopy ) {
			return false;
		}
	}
	return true;
}

function hashFile( filePath: string ): string {
	return crypto.createHash( 'sha1' ).update( fs.readFileSync( filePath ) ).digest( 'hex' );
}
