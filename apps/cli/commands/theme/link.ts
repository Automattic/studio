import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { ThemeCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { pickLocalSite } from 'cli/lib/local-site-picker';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

/**
 * Creates a symlink for a theme, with Windows junction fallback.
 *
 * @param sourcePath - Absolute path to the source theme directory
 * @param targetPath - Absolute path where the symlink should be created
 */
async function createThemeSymlink( sourcePath: string, targetPath: string ): Promise< void > {
	// Use relative path for standard symlinks (more portable)
	const relativePath = path.relative( path.dirname( targetPath ), sourcePath );

	try {
		await fs.promises.symlink( relativePath, targetPath );
	} catch ( error ) {
		// On Windows, symlinks may require admin privileges or Developer Mode.
		// Fall back to a directory junction which doesn't require elevated permissions.
		if ( isErrnoException( error ) && error.code === 'EPERM' && process.platform === 'win32' ) {
			// Junctions require absolute paths
			await fs.promises.symlink( path.resolve( sourcePath ), targetPath, 'junction' );
		} else {
			throw error;
		}
	}
}

/**
 * Validates that a directory looks like a WordPress theme.
 * Checks for presence of style.css with Theme Name header.
 */
async function isValidThemeDirectory( themePath: string ): Promise< boolean > {
	try {
		const stylePath = path.join( themePath, 'style.css' );
		if ( ! ( await pathExists( stylePath ) ) ) {
			return false;
		}

		const content = await fs.promises.readFile( stylePath, 'utf-8' );
		return content.includes( 'Theme Name:' );
	} catch {
		return false;
	}
}

export async function runCommand( sitePath: string, sourcePath?: string ): Promise< void > {
	// Use current directory if no source path provided
	const absoluteSourcePath = path.resolve( sourcePath ? untildify( sourcePath ) : process.cwd() );

	// Resolve site: try --path, fall back to picker if it's not a site and stdin is a TTY
	let resolvedSitePath = sitePath;
	try {
		await getSiteByFolder( sitePath );
	} catch ( error ) {
		if ( ! process.stdin.isTTY ) {
			throw error;
		}
		const picked = await pickLocalSite( __( 'Select a site to link the theme to' ) );
		if ( ! picked ) {
			throw error;
		}
		resolvedSitePath = picked.path;
	}

	logger.reportStart( LoggerAction.LINK, __( 'Linking theme…' ) );

	// Validate source exists
	if ( ! ( await pathExists( absoluteSourcePath ) ) ) {
		throw new LoggerError( sprintf( __( 'Source path does not exist: %s' ), absoluteSourcePath ) );
	}

	// Validate source is a directory
	const sourceStats = await fs.promises.stat( absoluteSourcePath );
	if ( ! sourceStats.isDirectory() ) {
		throw new LoggerError(
			sprintf( __( 'Source path is not a directory: %s' ), absoluteSourcePath )
		);
	}

	// Validate it looks like a theme
	if ( ! ( await isValidThemeDirectory( absoluteSourcePath ) ) ) {
		throw new LoggerError(
			__(
				'Source directory does not appear to be a valid WordPress theme. ' +
					'Expected a style.css file with a "Theme Name:" header.'
			)
		);
	}

	// Determine theme name from directory name
	const themeName = path.basename( absoluteSourcePath );
	if ( ! themeName || themeName === '.' || themeName === '..' ) {
		throw new LoggerError(
			sprintf(
				__( 'Could not determine a valid theme directory name from source path: %s' ),
				absoluteSourcePath
			)
		);
	}
	const themesDir = path.join( resolvedSitePath, 'wp-content', 'themes' );
	const targetPath = path.join( themesDir, themeName );

	// Check if target already exists
	if ( await pathExists( targetPath ) ) {
		// Check if it's already a symlink to the same source
		try {
			const stats = await fs.promises.lstat( targetPath );
			if ( stats.isSymbolicLink() ) {
				const linkTarget = await fs.promises.readlink( targetPath );
				const resolvedTarget = path.resolve( path.dirname( targetPath ), linkTarget );
				if ( resolvedTarget === absoluteSourcePath ) {
					logger.reportSuccess(
						sprintf( __( 'Theme "%s" is already linked to %s' ), themeName, absoluteSourcePath )
					);
					return;
				}
				throw new LoggerError(
					sprintf(
						__( 'Theme "%s" is already linked to a different location: %s' ),
						themeName,
						resolvedTarget
					)
				);
			}
		} catch ( error ) {
			if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
				throw error;
			}
		}

		throw new LoggerError(
			sprintf(
				__( 'A theme named "%s" already exists. Remove it first or use a different name.' ),
				themeName
			)
		);
	}

	// Ensure themes directory exists
	await fs.promises.mkdir( themesDir, { recursive: true } );

	// Create the symlink
	await createThemeSymlink( absoluteSourcePath, targetPath );

	logger.reportSuccess( sprintf( __( 'Linked theme "%s" → %s' ), themeName, absoluteSourcePath ) );
	console.log( __( 'Changes to the source directory will be reflected immediately in the site.' ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'link [source]',
		describe: __( 'Link an external theme directory to the site' ),
		builder: ( linkYargs ) => {
			return linkYargs.positional( 'source', {
				type: 'string',
				describe: __( 'Path to the theme directory to link (defaults to current directory)' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.source as string | undefined );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to link theme' ), error ) );
				}
			}
		},
	} );
};
