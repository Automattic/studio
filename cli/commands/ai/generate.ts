import { input, select, confirm } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { getAuthToken } from 'cli/lib/appdata';
import ora from 'ora';
import chalk from 'chalk';
import type { StudioArgv } from 'cli/types';
import { TelexClient } from 'cli/lib/telex-client';
import { parseArtefactXml, getBlockMetadata } from 'cli/lib/artefact-parser';
import {
	installBlockToSite,
	listStudioSites,
	studioSiteExists,
	getPluginActivationUrl,
} from 'cli/lib/block-installer';
import { getTelexApiUrl } from 'cli/lib/telex-constants';

interface GenerateOptions {
	prompt?: string;
	site?: string;
}

/**
 * Run the 'ai generate' command to create a WordPress block using AI
 */
export async function runCommand( options: GenerateOptions ): Promise< void > {
	const spinner = ora();

	try {
		// 1. Check authentication
		spinner.start( __( 'Checking authentication...' ) );
		const authToken = await getAuthToken();
		if ( ! authToken ) {
			spinner.fail( __( 'Not authenticated with WordPress.com' ) );
			console.log(
				chalk.yellow( '\nPlease run:' ),
				chalk.cyan( 'studio auth login' )
			);
			return;
		}
		spinner.succeed(
			__( 'Authenticated as %s', chalk.cyan( authToken.displayName ) )
		);

		// 2. Get prompt from user or flag
		const prompt =
			options.prompt ||
			( await input( {
				message: __( 'Describe the block you want to create:' ),
				validate: ( value ) =>
					value.trim().length > 0 || __( 'Please enter a prompt' ),
			} ) );

		console.log( chalk.dim( `\nPrompt: "${ prompt }"\n` ) );

		// 3. Initialize Telex client
		const telexApiUrl = getTelexApiUrl();
		const telex = new TelexClient( telexApiUrl, authToken.accessToken );

		// 4. Generate block
		spinner.start( __( 'Connecting to Telex AI...' ) );

		let chatText = '';
		let currentLine = '';

		try {
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

			// 5. Parse artefact
			const artefact = parseArtefactXml( result.artefact );
			const metadata = getBlockMetadata( artefact );

			// Show block info
			console.log( chalk.bold( '\nGenerated Block:' ) );
			console.log( chalk.gray( '  Name:  ' ), chalk.white( artefact.name ) );
			console.log( chalk.gray( '  Slug:  ' ), chalk.white( artefact.slug ) );
			console.log(
				chalk.gray( '  Files: ' ),
				chalk.white( artefact.files.length )
			);

			if ( metadata?.title ) {
				console.log(
					chalk.gray( '  Title: ' ),
					chalk.white( metadata.title )
				);
			}

			// 6. Ask what to do with the block
			const action = await select( {
				message: __( 'What would you like to do?' ),
				choices: [
					{
						value: 'install',
						name: __( 'Install to local Studio site' ),
					},
					{
						value: 'preview',
						name: __( 'Open in Telex web editor' ),
					},
					{
						value: 'exit',
						name: __( 'Exit (block saved in Telex)' ),
					},
				],
			} );

			// 7. Handle action
			if ( action === 'install' ) {
				await handleInstall( artefact, options.site, spinner );
			} else if ( action === 'preview' ) {
				const url = telex.getProjectUrl( result.epid );
				console.log(
					chalk.green( '\n✓' ),
					__( 'Open in your browser:' ),
					chalk.cyan( url )
				);
			} else {
				console.log(
					chalk.green( '\n✓' ),
					__( 'Block saved to your Telex account' )
				);
			}
		} catch ( error ) {
			spinner.fail( __( 'Block generation failed' ) );

			if ( error instanceof Error ) {
				console.error( chalk.red( '\nError:' ), error.message );
			}

			throw error;
		}
	} catch ( error ) {
		if ( spinner.isSpinning ) {
			spinner.fail();
		}

		if ( error instanceof Error && error.message !== 'User force closed the prompt' ) {
			// Don't show error if user pressed Ctrl+C
			console.error( chalk.red( '\nCommand failed:' ), error.message );
		}

		process.exit( 1 );
	}
}

/**
 * Handle block installation to Studio site
 */
async function handleInstall(
	artefact: ReturnType< typeof parseArtefactXml >,
	siteName: string | undefined,
	spinner: ReturnType< typeof ora >
): Promise< void > {
	// Get or select site
	let selectedSite = siteName;

	if ( ! selectedSite ) {
		const sites = await listStudioSites();

		if ( sites.length === 0 ) {
			console.log(
				chalk.yellow( '\n⚠ No Studio sites found' )
			);
			console.log(
				chalk.gray( 'Create a site with:' ),
				chalk.cyan( 'studio site create' )
			);
			return;
		}

		selectedSite = await select( {
			message: __( 'Select a Studio site:' ),
			choices: sites.map( ( site ) => ( {
				value: site,
				name: site,
			} ) ),
		} );
	}

	// Verify site exists
	if ( ! studioSiteExists( selectedSite ) ) {
		console.error(
			chalk.red( `\n✗ Site '${ selectedSite }' not found` )
		);
		console.log(
			chalk.gray( 'Available sites:' ),
			( await listStudioSites() ).join( ', ' )
		);
		return;
	}

	// Check if plugin already exists
	const overwrite = await confirm( {
		message: __(
			'Install "%s" to %s?',
			artefact.name,
			selectedSite
		),
		default: true,
	} );

	if ( ! overwrite ) {
		console.log( chalk.yellow( '\nInstallation cancelled' ) );
		return;
	}

	// Install
	spinner.start( __( 'Installing block to %s...', selectedSite ) );

	try {
		await installBlockToSite( selectedSite, artefact );
		spinner.succeed( __( 'Block installed to %s', chalk.cyan( selectedSite ) ) );

		// Show next steps
		const pluginUrl = getPluginActivationUrl( selectedSite, artefact.slug );

		console.log( chalk.bold( '\n📦 Next Steps:' ) );
		console.log( chalk.gray( '  1.' ), 'Visit', chalk.cyan( pluginUrl ) );
		console.log(
			chalk.gray( '  2.' ),
			'Activate',
			chalk.cyan( `"${ artefact.name }"` )
		);
		console.log(
			chalk.gray( '  3.' ),
			'Create a post and add the block'
		);
	} catch ( error ) {
		spinner.fail( __( 'Installation failed' ) );
		throw error;
	}
}

/**
 * Register the 'ai generate' command with Yargs
 */
export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'generate [prompt]',
		describe: __( 'Generate a WordPress block using AI' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'prompt', {
					type: 'string',
					describe: __( 'Describe the block you want to create' ),
				} )
				.option( 'site', {
					type: 'string',
					describe: __( 'Studio site to install the block to' ),
					alias: 's',
				} )
				.example(
					'$0 ai generate',
					__( 'Interactively create a block' )
				)
				.example(
					'$0 ai generate "testimonial carousel"',
					__( 'Create a block from prompt' )
				)
				.example(
					'$0 ai generate "hero section" --site mysite',
					__( 'Create and install to site' )
				);
		},
		handler: async ( argv ) => {
			await runCommand( {
				prompt: argv.prompt,
				site: argv.site,
			} );
		},
	} );
};
