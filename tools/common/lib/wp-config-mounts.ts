import fs from 'fs';
import nodePath from 'path';

interface MountPath {
	hostPath: string;
	vfsPath: string;
}

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
	const wpConfigPath = nodePath.join( sitePath, 'wp-config.php' );

	let configContent: string;
	try {
		configContent = fs.readFileSync( wpConfigPath, 'utf8' );
	} catch {
		return [];
	}

	// Match define() calls with string values that look like absolute paths.
	// Handles both single and double quotes, with optional whitespace.
	// Examples:
	//   define( 'MY_PATH', '/Users/me/Developer' );
	//   define("WORKSPACE_DIR", "/home/user/workspace");
	const defineRegex = /define\(\s*['"][^'"]+['"]\s*,\s*['"](\/[^'"]+)['"]\s*\)/g;

	const mounts: MountPath[] = [];
	const seen = new Set< string >();
	const normalizedSitePath = nodePath.resolve( sitePath );

	let match: RegExpExecArray | null;
	while ( ( match = defineRegex.exec( configContent ) ) !== null ) {
		const rawPath = match[ 1 ];

		// Resolve to handle any trailing slashes or relative segments
		const resolvedPath = nodePath.resolve( rawPath );

		// Skip if already seen (avoid duplicate mounts)
		if ( seen.has( resolvedPath ) ) {
			continue;
		}
		seen.add( resolvedPath );

		// Skip paths inside the site folder (already mounted at /wordpress)
		if (
			resolvedPath === normalizedSitePath ||
			resolvedPath.startsWith( normalizedSitePath + nodePath.sep )
		) {
			continue;
		}

		// Skip paths that don't exist on disk
		if ( ! fs.existsSync( resolvedPath ) ) {
			continue;
		}

		// Skip sensitive system paths. Compare against the raw POSIX-style path
		// captured from the regex (not the resolved path), so detection works the
		// same on Windows where path.resolve() would prepend a drive letter and
		// break a literal "/etc/" prefix match.
		const sensitiveRoots = [ '/etc', '/var', '/proc', '/sys', '/dev' ];
		if ( sensitiveRoots.some( ( root ) => rawPath === root || rawPath.startsWith( root + '/' ) ) ) {
			continue;
		}

		mounts.push( {
			hostPath: resolvedPath,
			vfsPath: resolvedPath,
		} );
	}

	return mounts;
}
