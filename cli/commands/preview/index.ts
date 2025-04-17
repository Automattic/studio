import { __ } from '@wordpress/i18n';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { StudioArgv } from 'cli/types';

export const registerPreviewCommands = ( yargs: StudioArgv ): StudioArgv => {
	registerCreateCommand( yargs );
	return yargs.command( {
		command: 'preview',
		describe: __( 'Manage preview sites' ),
		builder: ( yargs ) => {
			registerListCommand( yargs );
			registerDeleteCommand( yargs );
			registerUpdateCommand( yargs );
			return yargs.demandCommand( 1, __( 'You need to specify a preview command' ) );
		},
		handler: () => {},
	} );
};
