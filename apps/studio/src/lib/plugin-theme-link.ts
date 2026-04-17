import fs from 'fs';
import nodePath from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';

export type ExtensionKind = 'plugin' | 'theme';

export interface LinkedExtension {
	name: string;
	sourcePath: string;
}

const SUBDIR: Record< ExtensionKind, string > = {
	plugin: nodePath.join( 'wp-content', 'plugins' ),
	theme: nodePath.join( 'wp-content', 'themes' ),
};

function targetDirFor( kind: ExtensionKind, sitePath: string ): string {
	return nodePath.join( sitePath, SUBDIR[ kind ] );
}

export class PluginThemeLinkError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'PluginThemeLinkError';
	}
}

async function isValidPluginDirectory( pluginPath: string ): Promise< boolean > {
	try {
		const files = await fs.promises.readdir( pluginPath );
		const phpFiles = files.filter( ( f ) => f.endsWith( '.php' ) );
		for ( const phpFile of phpFiles ) {
			const content = await fs.promises.readFile( nodePath.join( pluginPath, phpFile ), 'utf-8' );
			if ( content.includes( 'Plugin Name:' ) ) {
				return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

async function isValidThemeDirectory( themePath: string ): Promise< boolean > {
	try {
		const stylePath = nodePath.join( themePath, 'style.css' );
		if ( ! ( await pathExists( stylePath ) ) ) {
			return false;
		}
		const content = await fs.promises.readFile( stylePath, 'utf-8' );
		return content.includes( 'Theme Name:' );
	} catch {
		return false;
	}
}

async function isValidSourceDirectory(
	kind: ExtensionKind,
	sourcePath: string
): Promise< boolean > {
	return kind === 'plugin'
		? isValidPluginDirectory( sourcePath )
		: isValidThemeDirectory( sourcePath );
}

async function createSymlinkWithFallback(
	sourcePath: string,
	targetPath: string
): Promise< void > {
	const relativePath = nodePath.relative( nodePath.dirname( targetPath ), sourcePath );
	try {
		await fs.promises.symlink( relativePath, targetPath );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'EPERM' && process.platform === 'win32' ) {
			await fs.promises.symlink( nodePath.resolve( sourcePath ), targetPath, 'junction' );
		} else {
			throw error;
		}
	}
}

export async function listLinkedExtensions(
	kind: ExtensionKind,
	sitePath: string
): Promise< LinkedExtension[] > {
	const dir = targetDirFor( kind, sitePath );
	if ( ! ( await pathExists( dir ) ) ) {
		return [];
	}

	const entries = await fs.promises.readdir( dir, { withFileTypes: true } );
	const linked: LinkedExtension[] = [];

	for ( const entry of entries ) {
		const entryPath = nodePath.join( dir, entry.name );
		try {
			const stats = await fs.promises.lstat( entryPath );
			if ( stats.isSymbolicLink() ) {
				const linkTarget = await fs.promises.readlink( entryPath );
				const resolvedTarget = nodePath.resolve( nodePath.dirname( entryPath ), linkTarget );
				linked.push( { name: entry.name, sourcePath: resolvedTarget } );
			}
		} catch {
			continue;
		}
	}

	return linked;
}

export interface LinkResult {
	name: string;
	sourcePath: string;
	alreadyLinked: boolean;
}

export async function linkExtension(
	kind: ExtensionKind,
	sitePath: string,
	sourcePath: string
): Promise< LinkResult > {
	const absoluteSourcePath = nodePath.resolve( sourcePath );

	if ( ! ( await pathExists( absoluteSourcePath ) ) ) {
		throw new PluginThemeLinkError( `Source path does not exist: ${ absoluteSourcePath }` );
	}

	const sourceStats = await fs.promises.stat( absoluteSourcePath );
	if ( ! sourceStats.isDirectory() ) {
		throw new PluginThemeLinkError( `Source path is not a directory: ${ absoluteSourcePath }` );
	}

	if ( ! ( await isValidSourceDirectory( kind, absoluteSourcePath ) ) ) {
		throw new PluginThemeLinkError(
			kind === 'plugin'
				? 'Source directory does not appear to be a valid WordPress plugin. Expected a PHP file with a "Plugin Name:" header.'
				: 'Source directory does not appear to be a valid WordPress theme. Expected a style.css file with a "Theme Name:" header.'
		);
	}

	const name = nodePath.basename( absoluteSourcePath );
	if ( ! name || name === '.' || name === '..' ) {
		throw new PluginThemeLinkError(
			`Could not determine a valid ${ kind } name from source path: ${ absoluteSourcePath }`
		);
	}

	const dir = targetDirFor( kind, sitePath );
	const targetPath = nodePath.join( dir, name );

	if ( await pathExists( targetPath ) ) {
		try {
			const stats = await fs.promises.lstat( targetPath );
			if ( stats.isSymbolicLink() ) {
				const linkTarget = await fs.promises.readlink( targetPath );
				const resolvedTarget = nodePath.resolve( nodePath.dirname( targetPath ), linkTarget );
				if ( resolvedTarget === absoluteSourcePath ) {
					return { name, sourcePath: absoluteSourcePath, alreadyLinked: true };
				}
				throw new PluginThemeLinkError(
					`${
						kind === 'plugin' ? 'Plugin' : 'Theme'
					} "${ name }" is already linked to a different location: ${ resolvedTarget }`
				);
			}
		} catch ( error ) {
			if ( error instanceof PluginThemeLinkError ) {
				throw error;
			}
			if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
				throw error;
			}
		}

		throw new PluginThemeLinkError(
			`A ${ kind } named "${ name }" already exists. Remove it first or use a different name.`
		);
	}

	await fs.promises.mkdir( dir, { recursive: true } );
	await createSymlinkWithFallback( absoluteSourcePath, targetPath );

	return { name, sourcePath: absoluteSourcePath, alreadyLinked: false };
}

export interface UnlinkResult {
	name: string;
	sourcePath: string;
}

export async function unlinkExtension(
	kind: ExtensionKind,
	sitePath: string,
	name: string
): Promise< UnlinkResult > {
	if ( ! name ) {
		throw new PluginThemeLinkError(
			`${ kind === 'plugin' ? 'Plugin' : 'Theme' } name is required`
		);
	}

	if ( nodePath.basename( name ) !== name ) {
		throw new PluginThemeLinkError(
			`Invalid ${ kind } name "${ name }": must be a single directory name without path separators`
		);
	}

	const dir = targetDirFor( kind, sitePath );
	const targetPath = nodePath.join( dir, name );

	if ( ! ( await pathExists( targetPath ) ) ) {
		throw new PluginThemeLinkError(
			`${ kind === 'plugin' ? 'Plugin' : 'Theme' } "${ name }" not found in site`
		);
	}

	const stats = await fs.promises.lstat( targetPath );
	if ( ! stats.isSymbolicLink() ) {
		throw new PluginThemeLinkError(
			`${ kind === 'plugin' ? 'Plugin' : 'Theme' } "${ name }" is not a linked ${ kind }.`
		);
	}

	const linkTarget = await fs.promises.readlink( targetPath );
	const resolvedTarget = nodePath.resolve( nodePath.dirname( targetPath ), linkTarget );

	await fs.promises.unlink( targetPath );

	return { name, sourcePath: resolvedTarget };
}
