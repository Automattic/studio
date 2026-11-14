import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { readActiveThemes } from 'cli/lib/active-themes';

const DEFAULT_THEME_PATTERN = /^twentytwenty[a-z]*$/;

/**
 * The active default themes (Twenty Twenty-Five and the like) whose files a site has edited.
 *
 * WordPress.com keeps its own copy of the default themes and uses it instead of an uploaded one,
 * so edits to a default theme's files don't reach a preview. A theme counts as edited when one of
 * its files isn't in Studio's stock copy of the same version, or differs from it. Themes Studio
 * has no stock copy of are skipped, so this never reports a theme it can't check.
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
		const stockPath = version && findStockTheme( wordPressVersionsPath, slug, version );
		if ( stockPath && ! matchesStockTheme( themePath, stockPath ) ) {
			edited.push( slug );
		}
	}
	return edited;
}

function readThemeVersion( themePath: string ): string | null {
	try {
		const styleCss = fs.readFileSync( path.join( themePath, 'style.css' ), 'utf8' );
		return /^[ \t/*#@]*Version:\s*(.+?)\s*$/im.exec( styleCss )?.[ 1 ] ?? null;
	} catch {
		return null;
	}
}

// A copy of the theme at this version from one of the WordPress versions Studio has downloaded.
function findStockTheme( wordPressVersionsPath: string, slug: string, version: string ) {
	let wordPressVersions: string[];
	try {
		wordPressVersions = fs.readdirSync( wordPressVersionsPath );
	} catch {
		return null;
	}
	for ( const wordPressVersion of wordPressVersions ) {
		const stockPath = path.join(
			wordPressVersionsPath,
			wordPressVersion,
			'wp-content',
			'themes',
			slug
		);
		if ( readThemeVersion( stockPath ) === version ) {
			return stockPath;
		}
	}
	return null;
}

// Whether every file of the site's theme is in the stock copy, unchanged. Dotfiles are ignored.
function matchesStockTheme( themePath: string, stockPath: string ): boolean {
	const relativePaths = fs.readdirSync( themePath, { recursive: true, encoding: 'utf8' } );
	for ( const relativePath of relativePaths ) {
		if ( relativePath.split( path.sep ).some( ( part ) => part.startsWith( '.' ) ) ) {
			continue;
		}
		const filePath = path.join( themePath, relativePath );
		if ( ! fs.statSync( filePath ).isFile() ) {
			continue;
		}
		const stockFilePath = path.join( stockPath, relativePath );
		const stockStat = fs.statSync( stockFilePath, { throwIfNoEntry: false } );
		if (
			! stockStat?.isFile() ||
			stockStat.size !== fs.statSync( filePath ).size ||
			hashFile( stockFilePath ) !== hashFile( filePath )
		) {
			return false;
		}
	}
	return true;
}

function hashFile( filePath: string ): string {
	return crypto.createHash( 'sha1' ).update( fs.readFileSync( filePath ) ).digest( 'hex' );
}
