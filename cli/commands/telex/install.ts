import { input } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import type { StudioArgv } from 'cli/types';
import { runTelexCommand } from 'cli/lib/telex-command-utils';

interface InstallOptions {
	projectId?: string;
}

/**
 * Extract EPID from Telex URL or return as-is if already an EPID
 * Examples:
 * - https://telex.automattic.ai/projects/v1.abc123 → v1.abc123
 * - v1.abc123 → v1.abc123
 */
function extractEpid( input: string ): string {
	const match = input.match( /\/projects\/([^\/\?#]+)/ );
	return match ? match[ 1 ] : input;
}

/**
 * Run the 'telex install' command to install a block from Telex
 */
export async function runCommand( options: InstallOptions, sitePath: string ): Promise< void > {
	// Get project ID from user or flag
	const projectInput =
		options.projectId ||
		( await input( {
			message: __( 'Enter Telex project URL or ID:' ),
			validate: ( value ) =>
				value.trim().length > 0 || __( 'Please enter a project URL or ID' ),
		} ) );

	const epid = extractEpid( projectInput );
	console.log( chalk.dim( `\nProject ID: ${ epid }\n` ) );

	// Use shared command flow
	await runTelexCommand( options, sitePath, async ( telex, spinner ) => {
		// Fetch block artefact
		spinner.start( __( 'Fetching block from Telex...' ) );
		const artefact = await telex.fetchBlock( epid );
		spinner.succeed( __( 'Block fetched successfully!' ) );

		// Show Telex UI URL
		const telexUrl = telex.getProjectUrl( epid );
		console.log(
			chalk.gray( '  Telex: ' ),
			chalk.cyan( telexUrl )
		);

		return artefact;
	} );
}

/**
 * Register the 'telex install' command with Yargs
 */
export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'install [project-id]',
		describe: __( 'Install a block from Telex to your local site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'project-id', {
					type: 'string',
					describe: __( 'Telex project URL or ID' ),
				} )
				.example(
					'$0 telex install',
					__( 'Interactively install a block' )
				)
				.example(
					'$0 telex install v1.abc123',
					__( 'Install block by ID' )
				)
				.example(
					'$0 telex install https://telex.automattic.ai/projects/v1.abc123',
					__( 'Install block by URL' )
				);
		},
		handler: async ( argv ) => {
			await runCommand(
				{
					projectId: argv.projectId,
				},
				argv.path
			);
		},
	} );
};
