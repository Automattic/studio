import { input } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import type { StudioArgv } from 'cli/types';
import { runTelexCommand } from 'cli/lib/telex-command-utils';

interface BlockOptions {
	prompt?: string;
}

/**
 * Run the 'telex block' command to create a WordPress block using AI
 */
export async function runCommand( options: BlockOptions, sitePath: string ): Promise< void > {
	// Get prompt from user or flag
	const prompt =
		options.prompt ||
		( await input( {
			message: __( 'Describe the block you want to create:' ),
			validate: ( value ) =>
				value.trim().length > 0 || __( 'Please enter a prompt' ),
		} ) );

	console.log( chalk.dim( `\nPrompt: "${ prompt }"\n` ) );

	// Use shared command flow
	await runTelexCommand( options, sitePath, async ( telex, spinner ) => {
		// Generate block with AI
		spinner.start( __( 'Connecting to Telex AI...' ) );

		let chatText = '';
		let currentLine = '';

		const result = await telex.generateBlock( prompt, {
			onChunk: ( text ) => {
				chatText += text;
				currentLine += text;

				// Update spinner with last line of AI response
				if ( text.includes( '\n' ) ) {
					const lines = currentLine.split( '\n' );
					currentLine = lines[ lines.length - 1 ];
				}

				const displayText =
					currentLine.length > 60
						? currentLine.slice( -60 )
						: currentLine;
				spinner.text = chalk.cyan( `AI: ${ displayText.trim() }` );
			},
			onArtefact: () => {
				spinner.text = __( 'Receiving block files...' );
			},
		} );

		spinner.succeed( __( 'Block generated successfully!' ) );

		// Show AI explanation
		if ( chatText ) {
			console.log( chalk.dim( '\n' + '─'.repeat( 60 ) ) );
			console.log( chalk.cyan( '\nAI Response:\n' ) );
			console.log( chatText.trim() );
			console.log( chalk.dim( '\n' + '─'.repeat( 60 ) + '\n' ) );
		}

		// Show Telex UI URL
		const telexUrl = telex.getProjectUrl( result.epid );
		console.log(
			chalk.gray( '\n  Telex: ' ),
			chalk.cyan( telexUrl )
		);

		// Wait for build and fetch complete block with built files
		spinner.start( __( 'Waiting for build to complete...' ) );
		const artefact = await telex.fetchBlock( result.epid, undefined, ( attempt, max ) => {
			spinner.text = __( 'Waiting for build to complete...' ) + ` (${ attempt }/${ max })`;
		} );
		spinner.succeed( __( 'Build complete! Block ready for installation.' ) );

		return artefact;
	} );
}

/**
 * Register the 'telex block' command with Yargs
 */
export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'block [prompt]',
		describe: __( 'Generate a WordPress block using AI and install it' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'prompt', {
					type: 'string',
					describe: __( 'Describe the block you want to create' ),
				} )
				.example(
					'$0 telex block',
					__( 'Interactively create a block' )
				)
				.example(
					'$0 telex block "testimonial carousel"',
					__( 'Create a testimonial carousel block' )
				)
				.example(
					'$0 telex block "hero section" --path ~/sites/mysite',
					__( 'Create and install to specific site' )
				);
		},
		handler: async ( argv ) => {
			await runCommand(
				{
					prompt: argv.prompt,
				},
				argv.path
			);
		},
	} );
};
