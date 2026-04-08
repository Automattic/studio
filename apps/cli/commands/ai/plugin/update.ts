import { __ } from '@wordpress/i18n';
import { AiPluginManager } from 'cli/ai/plugin-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand( options: { checkOnly: boolean } ): Promise< void > {
	const manager = new AiPluginManager();
	const plugins = manager.getDefaultPlugins();

	for ( const manifest of plugins ) {
		if ( options.checkOnly ) {
			const result = await manager.checkForUpdates( manifest );
			if ( result.available ) {
				console.log(
					`${ manifest.name }: update available (${ result.currentVersion } → ${ result.latestVersion })`
				);
			} else {
				console.log( `${ manifest.name }: up to date` );
			}
			continue;
		}

		const result = await manager.update( manifest );
		if ( result.error ) {
			console.log( `${ manifest.name }: ${ result.error }` );
		} else if ( result.updated ) {
			console.log( `${ manifest.name }: updated ${ result.oldVersion } → ${ result.newVersion }` );
		} else {
			console.log( `${ manifest.name }: up to date` );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'update',
		describe: __( 'Update AI plugins to the latest version' ),
		builder: ( updateYargs ) => {
			return updateYargs.option( 'check', {
				type: 'boolean',
				default: false,
				description: __( 'Only check for updates without applying them' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( { checkOnly: argv.check as boolean } );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to update AI plugins' ), error ) );
				}
			}
		},
	} );
};
