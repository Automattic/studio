import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { PluginCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { pickLocalSite } from 'cli/lib/local-site-picker';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

/**
 * Creates a symlink for a plugin, with Windows junction fallback.
 *
 * @param sourcePath - Absolute path to the source plugin directory
 * @param targetPath - Absolute path where the symlink should be created
 */
async function createPluginSymlink( sourcePath: string, targetPath: string ): Promise< void > {
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
 * Validates that a directory looks like a WordPress plugin.
 * Checks for presence of a PHP file with Plugin Name header.
 */
async function isValidPluginDirectory( pluginPath: string ): Promise< boolean > {
	try {
		const files = await fs.promises.readdir( pluginPath );
		const phpFiles = files.filter( ( f ) => f.endsWith( '.php' ) );

		for ( const phpFile of phpFiles ) {
			const content = await fs.promises.readFile( path.join( pluginPath, phpFile ), 'utf-8' );
			if ( content.includes( 'Plugin Name:' ) ) {
				return true;
			}
		}
		return false;
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
		const picked = await pickLocalSite( __( 'Select a site to link the plugin to' ) );
		if ( ! picked ) {
			throw error;
		}
		resolvedSitePath = picked.path;
	}

	logger.reportStart( LoggerAction.LINK, __( 'Linking plugin…' ) );

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

	// Validate it looks like a plugin
	if ( ! ( await isValidPluginDirectory( absoluteSourcePath ) ) ) {
		throw new LoggerError(
			__(
				'Source directory does not appear to be a valid WordPress plugin. ' +
					'Expected a PHP file with a "Plugin Name:" header.'
			)
		);
	}

	// Resolve symlinks so subsequent scope checks operate on the real target.
	// Defends against AST04 (insecure metadata) by surfacing the true location
	// when a user-typed source path is itself a symlink.
	const realSourcePath = await fs.promises
		.realpath( absoluteSourcePath )
		.catch( () => absoluteSourcePath );

	// Reject sources inside the target site to prevent recursive symlinks
	// (a plugin symlinking back into its own site's wp-content).
	const resolvedSiteRealPath = await fs.promises
		.realpath( resolvedSitePath )
		.catch( () => resolvedSitePath );
	const sourceWithSep = realSourcePath + path.sep;
	const siteWithSep = resolvedSiteRealPath + path.sep;
	if ( realSourcePath === resolvedSiteRealPath || sourceWithSep.startsWith( siteWithSep ) ) {
		throw new LoggerError(
			sprintf( __( 'Source must not live inside the target site: %s' ), realSourcePath )
		);
	}

	// Determine plugin name from directory name
	const pluginName = path.basename( absoluteSourcePath );
	if ( ! pluginName || pluginName === '.' || pluginName === '..' ) {
		throw new LoggerError(
			sprintf(
				__( 'Could not determine a valid plugin name from source path: %s' ),
				absoluteSourcePath
			)
		);
	}
	const pluginsDir = path.join( resolvedSitePath, 'wp-content', 'plugins' );
	const targetPath = path.join( pluginsDir, pluginName );

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
						sprintf( __( 'Plugin "%s" is already linked to %s' ), pluginName, absoluteSourcePath )
					);
					return;
				}
				throw new LoggerError(
					sprintf(
						__( 'Plugin "%s" is already linked to a different location: %s' ),
						pluginName,
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
				__( 'A plugin named "%s" already exists. Remove it first or use a different name.' ),
				pluginName
			)
		);
	}

	// Ensure plugins directory exists
	await fs.promises.mkdir( pluginsDir, { recursive: true } );

	// Create the symlink
	await createPluginSymlink( absoluteSourcePath, targetPath );

	logger.reportSuccess(
		sprintf( __( 'Linked plugin "%s" → %s' ), pluginName, absoluteSourcePath )
	);
	if ( realSourcePath !== absoluteSourcePath ) {
		// Surface the real target so the user can spot symlink-chain shadowing.
		console.log( sprintf( __( 'Resolved source: %s' ), realSourcePath ) );
	}
	console.log( __( 'Changes to the source directory will be reflected immediately in the site.' ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'link [source]',
		describe: __( 'Link an external plugin directory to the site' ),
		builder: ( linkYargs ) => {
			return linkYargs.positional( 'source', {
				type: 'string',
				describe: __( 'Path to the plugin directory to link (defaults to current directory)' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.source as string | undefined );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to link plugin' ), error ) );
				}
			}
		},
	} );
};
