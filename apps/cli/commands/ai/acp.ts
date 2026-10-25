import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'acp',
		describe: __( 'Serve Studio Code over the Agent Client Protocol (for ACP editors)' ),
		handler: async () => {
			// Loaded here, not at the top: the server brings the whole agent runtime.
			const { startAcpStdioServer } = await import( 'cli/ai/runtimes/acp' );
			await startAcpStdioServer();
		},
	} );
};
