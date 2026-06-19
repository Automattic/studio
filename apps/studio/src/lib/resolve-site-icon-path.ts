import fs from 'fs';
import nodePath from 'path';

export function resolveSiteIconPath( sitePath: string, pathFromWordPress: string ): string {
	const wordpressRelativePath = pathFromWordPress.replace( /^[/\\]?wordpress[/\\]?/, '' );
	if ( wordpressRelativePath !== pathFromWordPress ) {
		return nodePath.join( sitePath, wordpressRelativePath );
	}

	const siteRoot = nodePath.resolve( sitePath );

	if ( nodePath.isAbsolute( pathFromWordPress ) ) {
		if ( fs.existsSync( pathFromWordPress ) ) {
			return pathFromWordPress;
		}

		const nestedPathPrefix = `${ siteRoot }${ nodePath.sep }`;
		if ( pathFromWordPress.startsWith( nestedPathPrefix ) ) {
			const rootedPath = nodePath.resolve(
				nodePath.sep,
				pathFromWordPress.slice( nestedPathPrefix.length )
			);
			if ( rootedPath.startsWith( nestedPathPrefix ) && fs.existsSync( rootedPath ) ) {
				return rootedPath;
			}
		}

		return pathFromWordPress;
	}

	const siteRelativePath = nodePath.join( sitePath, pathFromWordPress );
	if ( fs.existsSync( siteRelativePath ) ) {
		return siteRelativePath;
	}

	// Older mu-plugin code trimmed the leading slash from host-absolute
	// native-PHP paths before returning them. Rehydrate that shape when it
	// clearly points back into this site.
	const rootedPath = nodePath.resolve( nodePath.sep, pathFromWordPress );
	const nestedPathPrefix = `${ siteRoot }${ nodePath.sep }`;
	if ( rootedPath.startsWith( nestedPathPrefix ) && fs.existsSync( rootedPath ) ) {
		return rootedPath;
	}

	return siteRelativePath;
}
