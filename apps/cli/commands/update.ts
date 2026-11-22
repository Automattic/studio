import { updateConfig } from '@studio/common/lib/config/store';
import { __, sprintf } from '@wordpress/i18n';
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
				? __(
						'This WordPress Studio CLI was installed via npm. Update it with: npm update -g wp-studio'
				  )
				: __(
						'This WordPress Studio CLI is bundled with the WordPress Studio desktop app. Update it through the app.'
				  )
		);
		process.exitCode = 1;
		return;
	}
	try {
		if ( argv.autoUpdates !== undefined ) {
			await updateConfig( ( { cli } ) => {
				cli.cliAutoUpdates = argv.autoUpdates;
			} );
			console.log(
				argv.autoUpdates ? __( 'Automatic updates enabled.' ) : __( 'Automatic updates disabled.' )
			);
			return;
		}
		console.log( __( 'Checking for WordPress Studio CLI updates…' ) );
		const version = await updateStandaloneCli( __STUDIO_CLI_VERSION__ );
		console.log(
			version
				? sprintf(
						/* translators: %s: downloaded CLI version */
						__( 'WordPress Studio CLI %s is ready. Your next launch will use the new version.' ),
						version
				  )
				: __( 'WordPress Studio CLI is up to date.' )
		);
	} catch ( error ) {
		logger.reportError( new LoggerError( __( 'Failed to update WordPress Studio CLI.' ), error ) );
		process.exitCode = 1;
	}
}
