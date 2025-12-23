import { __, sprintf } from '@wordpress/i18n';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import ora from 'ora';
import chalk from 'chalk';
import { TelexClient, type Artefact } from 'cli/lib/telex-client';
import { getBlockMetadata } from 'cli/lib/artefact-parser';
import {
	installBlockToSitePath,
	getPluginActivationUrl,
} from 'cli/lib/block-installer';
import { getTelexApiUrl } from 'cli/lib/telex-constants';

interface TelexCommandOptions {
	// Reserved for future options
}

/**
 * Shared command execution flow for Telex block commands
 *
 * Handles authentication, site detection, installation, and next steps.
 * The only difference between commands is how they fetch the artefact.
 *
 * @param options - Command options
 * @param sitePath - Path to WordPress site
 * @param fetchArtefact - Callback to fetch the artefact (differs per command)
 */
export async function runTelexCommand(
	options: TelexCommandOptions,
	sitePath: string,
	fetchArtefact: ( telex: TelexClient, spinner: ora.Ora ) => Promise< Artefact >
): Promise< void > {
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
			sprintf( __( 'Authenticated as %s' ), chalk.cyan( authToken.displayName ) )
		);

		// 2. Detect current site
		spinner.start( __( 'Loading site...' ) );
		const site = await getSiteByFolder( sitePath );
		spinner.succeed( sprintf( __( 'Site: %s' ), chalk.cyan( site.name ) ) );

		// 3. Initialize Telex client
		const telexApiUrl = getTelexApiUrl();
		const telex = new TelexClient( telexApiUrl, authToken.accessToken );

		// 4. Fetch artefact (command-specific logic via callback)
		const artefact = await fetchArtefact( telex, spinner );

		// 5. Get block metadata
		const metadata = getBlockMetadata( artefact );

		// 6. Show block info
		console.log( chalk.bold( '\nBlock Information:' ) );
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

		// 7. Install to current site
		spinner.start( sprintf( __( 'Installing block to %s...' ), site.name ) );
		await installBlockToSitePath( site.path, artefact );
		spinner.succeed( sprintf( __( 'Block installed to %s' ), chalk.cyan( site.name ) ) );

		// 8. Show next steps
		const pluginUrl = getPluginActivationUrl( site.name, artefact.slug );

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
		if ( spinner.isSpinning ) {
			spinner.fail();
		}

		if ( error instanceof Error && error.message !== 'User force closed the prompt' ) {
			console.error( chalk.red( '\nCommand failed:' ), error.message );
		}

		process.exit( 1 );
	}
}
