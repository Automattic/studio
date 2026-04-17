import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { PluginCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { pickLocalSite } from 'cli/lib/local-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( sitePath: string, pluginName?: string ): Promise< void > {
	// Default plugin name to the current directory basename when omitted
	const resolvedPluginName = pluginName ?? path.basename( process.cwd() );

	if ( ! resolvedPluginName ) {
		throw new LoggerError( __( 'Plugin name is required' ) );
	}

	// Resolve site: try --path, fall back to picker if it's not a site and stdin is a TTY
	let resolvedSitePath = sitePath;
	try {
		await getSiteByFolder( sitePath );
	} catch ( error ) {
		if ( ! process.stdin.isTTY ) {
			throw error;
		}
		const picked = await pickLocalSite( __( 'Select a site to unlink the plugin from' ) );
		if ( ! picked ) {
			throw error;
		}
		resolvedSitePath = picked.path;
	}

	logger.reportStart( LoggerAction.UNLINK, __( 'Unlinking plugin…' ) );

	const pluginsDir = path.join( resolvedSitePath, 'wp-content', 'plugins' );
	const targetPath = path.join( pluginsDir, resolvedPluginName );

	// Check if target exists
	if ( ! ( await pathExists( targetPath ) ) ) {
		throw new LoggerError( sprintf( __( 'Plugin "%s" not found in site' ), resolvedPluginName ) );
	}

	// Check if it's a symlink
	try {
		const stats = await fs.promises.lstat( targetPath );
		if ( ! stats.isSymbolicLink() ) {
			throw new LoggerError(
				sprintf(
					__( 'Plugin "%s" is not a linked plugin. Use "studio wp plugin delete" to remove it.' ),
					resolvedPluginName
				)
			);
		}
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			throw new LoggerError( sprintf( __( 'Plugin "%s" not found in site' ), resolvedPluginName ) );
		}
		throw error;
	}

	// Get the link target for the success message
	const linkTarget = await fs.promises.readlink( targetPath );
	const resolvedTarget = path.resolve( path.dirname( targetPath ), linkTarget );

	// Remove the symlink (not the source!)
	await fs.promises.unlink( targetPath );

	logger.reportSuccess( sprintf( __( 'Unlinked plugin "%s"' ), resolvedPluginName ) );
	console.log( sprintf( __( 'Source directory preserved at: %s' ), resolvedTarget ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'unlink [plugin]',
		describe: __( 'Remove a linked plugin from the site (keeps source files)' ),
		builder: ( unlinkYargs ) => {
			return unlinkYargs.positional( 'plugin', {
				type: 'string',
				describe: __( 'Name of the linked plugin to remove (defaults to current directory name)' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.plugin as string | undefined );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to unlink plugin' ), error ) );
				}
			}
		},
	} );
};
