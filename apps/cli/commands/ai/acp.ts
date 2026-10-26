import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'acp',
		describe: __( 'Serve Studio Code over the Agent Client Protocol (for ACP editors)' ),
		builder: ( yargs ) =>
			// Editors run ACP terminal sign-in as `studio code acp` plus these args.
			yargs.option( 'login', {
				type: 'boolean',
				hidden: true,
				description: __( 'Log in to WordPress.com in this terminal, then exit' ),
			} ),
		handler: async ( argv ) => {
			if ( argv.login ) {
				const { runCommand: runLoginCommand } = await import( 'cli/commands/auth/login' );
				await runLoginCommand();
				return;
			}
			// Loaded here, not at the top: the server brings the whole agent runtime.
			const { startAcpStdioServer } = await import( 'cli/ai/runtimes/acp' );
			await startAcpStdioServer();
		},
	} );
};
