import fs from 'fs';
import path from 'path';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { isValidWordPressVersion } from '@studio/common/lib/wordpress-version-utils';
import { getWordPressVersionPath } from 'cli/lib/dependency-management/paths';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';

/** Whether the site's WordPress core is its own files rather than links into a pulled tree. */
export function hasOwnCore( sitePath: string ): boolean {
	const wpIncludes = fs.lstatSync( path.join( sitePath, 'wp-includes' ), {
		throwIfNoEntry: false,
	} );
	return !! wpIncludes?.isDirectory();
}

/**
 * Whether the pull can leave WordPress core out because the site keeps its own: a WordPress.org
 * release at the remote's version. Downloads that release when the site has another one.
 */
export async function canKeepOwnCore(
	sitePath: string,
	remoteWpVersion: string | undefined
): Promise< boolean > {
	if (
		! remoteWpVersion ||
		! isValidWordPressVersion( remoteWpVersion ) ||
		remoteWpVersion === 'latest' ||
		remoteWpVersion === 'nightly' ||
		! hasOwnCore( sitePath )
	) {
		return false;
	}
	if ( getWordPressVersion( sitePath ) === remoteWpVersion ) {
		return true;
	}
	try {
		await downloadWordPress( remoteWpVersion );
		return true;
	} catch {
		return false;
	}
}

/** Replaces the site's core with the given release, keeping wp-content. */
export async function installOwnCore( sitePath: string, version: string ): Promise< void > {
	if ( getWordPressVersion( sitePath ) === version ) {
		return;
	}
	const source = getWordPressVersionPath( version );
	for ( const entry of await fs.promises.readdir( source ) ) {
		if ( entry === 'wp-content' ) {
			continue;
		}
		const target = path.join( sitePath, entry );
		await fs.promises.rm( target, { recursive: true, force: true } );
		await fs.promises.cp( path.join( source, entry ), target, { recursive: true } );
	}
}

/** Points the site's wp-content at the pulled one, which already has what only the site had. */
export function linkPulledWpContent( sitePath: string, pulledWpContent: string ): void {
	const link = path.join( sitePath, 'wp-content' );
	if ( fs.lstatSync( link, { throwIfNoEntry: false } )?.isSymbolicLink() ) {
		return;
	}
	fs.rmSync( link, { recursive: true, force: true } );
	fs.symlinkSync( path.relative( sitePath, pulledWpContent ), link );
}
