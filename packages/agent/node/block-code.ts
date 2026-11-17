/**
 * The code a site registers its blocks from: the block.json, PHP and
 * JavaScript files of its active plugins and themes, as one version. A change
 * to it can change the blocks the site and its block editor register, as a
 * block's script does, or "autoRegister" added to a block's supports in PHP,
 * so a verdict of the editor on a block of the site's own holds for the
 * version it was given with.
 */
import path from 'path';
import { activeCodeVersion } from '@studio/agent/node/active-code';

/** The version of the code a site registers its blocks from. */
export function blockCodeVersion( sitePath: string ): Promise< string > {
	return activeCodeVersion( sitePath, ( name ) => /\.(php|js|json)$/.test( name ) );
}

// The version last read of each site's block code, by its folder, as the
// checks of the calls read it (block-editor-scripts.ts), and the version last
// given to each site's block editor, by its URL.
const read = new Map< string, string >();
const seen = new Map< string, string >();

/** Notes the version of a site's block code a check read. */
export function readBlockCode( sitePath: string, version: string ): void {
	read.set( path.resolve( sitePath ), version );
}

/** The version of a site's block code last read, if any. */
export function lastBlockCode( sitePath: string ): string | undefined {
	return read.get( path.resolve( sitePath ) );
}

/** Notes the version of a site's block code that what its block editor validates now runs. */
export function seeBlockCode( siteUrl: string, version: string ): void {
	seen.set( siteUrl, version );
}

/** The version of a site's block code its block editor was last given, if any. */
export function seenBlockCode( siteUrl: string ): string | undefined {
	return seen.get( siteUrl );
}
