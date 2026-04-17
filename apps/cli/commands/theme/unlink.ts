import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { ThemeCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { pickLocalSite } from 'cli/lib/local-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( sitePath: string, themeName?: string ): Promise< void > {
	// Default theme name to the current directory basename when omitted
	const resolvedThemeName = themeName ?? path.basename( process.cwd() );

	if ( ! resolvedThemeName ) {
		throw new LoggerError( __( 'Theme name is required' ) );
	}

	// Reject path traversal: theme name must be a single path segment
	if ( path.basename( resolvedThemeName ) !== resolvedThemeName ) {
		throw new LoggerError(
			sprintf(
				__( 'Invalid theme name "%s": must be a single directory name without path separators' ),
				resolvedThemeName
			)
		);
	}

	// Resolve site: try --path, fall back to picker if it's not a site and stdin is a TTY
	let resolvedSitePath = sitePath;
	try {
		await getSiteByFolder( sitePath );
	} catch ( error ) {
		if ( ! process.stdin.isTTY ) {
			throw error;
		}
		const picked = await pickLocalSite( __( 'Select a site to unlink the theme from' ) );
		if ( ! picked ) {
			throw error;
		}
		resolvedSitePath = picked.path;
	}

	logger.reportStart( LoggerAction.UNLINK, __( 'Unlinking theme…' ) );

	const themesDir = path.join( resolvedSitePath, 'wp-content', 'themes' );
	const targetPath = path.join( themesDir, resolvedThemeName );

	// Check if target exists
	if ( ! ( await pathExists( targetPath ) ) ) {
		throw new LoggerError( sprintf( __( 'Theme "%s" not found in site' ), resolvedThemeName ) );
	}

	// Check if it's a symlink
	try {
		const stats = await fs.promises.lstat( targetPath );
		if ( ! stats.isSymbolicLink() ) {
			throw new LoggerError(
				sprintf(
					__( 'Theme "%s" is not a linked theme. Use "studio wp theme delete" to remove it.' ),
					resolvedThemeName
				)
			);
		}
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			throw new LoggerError( sprintf( __( 'Theme "%s" not found in site' ), resolvedThemeName ) );
		}
		throw error;
	}

	// Get the link target for the success message
	const linkTarget = await fs.promises.readlink( targetPath );
	const resolvedTarget = path.resolve( path.dirname( targetPath ), linkTarget );

	// Remove the symlink (not the source!)
	await fs.promises.unlink( targetPath );

	logger.reportSuccess( sprintf( __( 'Unlinked theme "%s"' ), resolvedThemeName ) );
	console.log( sprintf( __( 'Source directory preserved at: %s' ), resolvedTarget ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'unlink [theme]',
		describe: __( 'Remove a linked theme from the site (keeps source files)' ),
		builder: ( unlinkYargs ) => {
			return unlinkYargs.positional( 'theme', {
				type: 'string',
				describe: __( 'Name of the linked theme to remove (defaults to current directory name)' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.theme as string | undefined );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to unlink theme' ), error ) );
				}
			}
		},
	} );
};
