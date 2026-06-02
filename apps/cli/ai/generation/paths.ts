import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export function deriveSlug( input: string ): string {
	return input
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

export function isValidSlug( slug: string ): boolean {
	return /^[a-z0-9][a-z0-9-]*$/.test( slug );
}

export function themeDir( sitePath: string, slug: string ): string {
	return path.join( sitePath, 'wp-content', 'themes', slug );
}

export function pluginDir( sitePath: string, slug: string ): string {
	return path.join( sitePath, 'wp-content', 'plugins', slug );
}

export function uploadsDir( sitePath: string, subdir = 'wsg' ): string {
	return path.join( sitePath, 'wp-content', 'uploads', subdir );
}

/**
 * Guards every generated write so a model-supplied relative path can never
 * escape the package directory (theme/plugin). Returns the resolved absolute
 * path on success; throws otherwise.
 */
export function assertInside( baseDir: string, relPath: string ): string {
	const base = path.resolve( baseDir );
	const resolved = path.resolve( base, relPath );
	if ( resolved !== base && ! resolved.startsWith( base + path.sep ) ) {
		throw new Error( `Refusing to write outside the package directory: ${ relPath }` );
	}
	return resolved;
}

export async function writePackageFile(
	baseDir: string,
	relPath: string,
	content: string
): Promise< string > {
	const full = assertInside( baseDir, relPath );
	await mkdir( path.dirname( full ), { recursive: true } );
	await writeFile( full, content, 'utf8' );
	return full;
}
