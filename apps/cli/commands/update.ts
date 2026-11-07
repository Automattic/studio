import { __, sprintf } from '@wordpress/i18n';
import { updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { updateStandaloneCli } from 'cli/lib/standalone-updates';
import { getCliInstallKind } from 'cli/lib/update-notifier';
import { Logger, LoggerError } from 'cli/logger';
import type { builder } from 'cli/commands/update.command';
import type { CommandArgs } from 'cli/types';

const logger = new Logger< string >();

export async function commandHandler( argv: CommandArgs< typeof builder > ): Promise< void > {
	const installKind = getCliInstallKind();
	if ( installKind !== 'standalone' ) {
		console.log(
			installKind === 'npm'
				? __( 'This Studio CLI was installed via npm. Update it with: npm update -g wp-studio' )
				: __( 'This Studio CLI is bundled with the Studio desktop app. Update it through the app.' )
		);
		process.exitCode = 1;
		return;
	}
	try {
		if ( argv.autoUpdates !== undefined ) {
			await updateCliConfigWithPartial( { cliAutoUpdates: argv.autoUpdates } );
			console.log(
				argv.autoUpdates ? __( 'Automatic updates enabled.' ) : __( 'Automatic updates disabled.' )
			);
			return;
		}
		console.log( __( 'Checking for Studio CLI updates…' ) );
		const version = await updateStandaloneCli( __STUDIO_CLI_VERSION__ );
		console.log(
			version
				? sprintf(
						/* translators: %s: downloaded CLI version */
						__( 'Studio CLI %s is ready. Your next launch will use the new version.' ),
						version
				  )
				: __( 'Studio CLI is up to date.' )
		);
	} catch ( error ) {
		logger.reportError( new LoggerError( __( 'Failed to update Studio CLI.' ), error ) );
		process.exitCode = 1;
	}
}
