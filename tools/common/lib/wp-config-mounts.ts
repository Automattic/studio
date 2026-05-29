import fs from 'fs';
import nodePath from 'path';

interface MountPath {
	hostPath: string;
	vfsPath: string;
}

const DEFINE_PATH_REGEX = /define\(\s*['"][^'"]+['"]\s*,\s*['"](\/[^'"]+)['"]\s*\)/g;
const SENSITIVE_ROOTS = [ '/etc', '/var', '/proc', '/sys', '/dev' ];

/**
 * Parses wp-config.php for define() constants whose values are absolute host paths
 * that exist on disk and are outside the site folder. Returns mount entries so PHP
 * can access those directories inside the WASM filesystem.
 *
 * On a real WordPress server with MariaDB, PHP can access any path the OS allows.
 * Studio's WASM sandbox restricts PHP to mounted directories. This function bridges
 * the gap by auto-detecting paths from wp-config.php and mounting them transparently.
 *
 * Each discovered path is mounted at its real host location (e.g. /Users/me/Developer
 * is mounted at /Users/me/Developer inside WASM) so PHP path constants work without
 * translation.
 */
export function getWpConfigMountPaths( sitePath: string ): MountPath[] {
	let configContent: string;
	try {
		configContent = fs.readFileSync( nodePath.join( sitePath, 'wp-config.php' ), 'utf8' );
	} catch {
		return [];
	}

	const mounts = new Map< string, MountPath >();
	const normalizedSitePath = nodePath.resolve( sitePath );

	for ( const match of configContent.matchAll( DEFINE_PATH_REGEX ) ) {
		const rawPath = match[ 1 ];
		const hostPath = nodePath.resolve( rawPath );

		if (
			hostPath === normalizedSitePath ||
			hostPath.startsWith( normalizedSitePath + nodePath.sep ) ||
			! fs.existsSync( hostPath ) ||
			SENSITIVE_ROOTS.some( ( root ) => rawPath === root || rawPath.startsWith( root + '/' ) )
		) {
			continue;
		}

		mounts.set( hostPath, { hostPath, vfsPath: hostPath } );
	}

	return [ ...mounts.values() ];
}
