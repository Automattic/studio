import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { suppressPunycodeWarning } from 'common/lib/suppress-punycode-warning';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { registerCommand as registerSitesCreateCommand } from 'cli/commands/sites/create';
import { registerCommand as registerSitesListCommand } from 'cli/commands/sites/list';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { version } from 'cli/package.json';
import { StudioArgv } from 'cli/types';

suppressPunycodeWarning();

async function main() {
	const locale = await loadTranslations();

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'WordPress Studio CLI' ) )
		.locale( locale )
		.version( version )
		.option( 'avoid-telemetry', {
			type: 'boolean',
			hidden: true,
		} )
		.option( 'path', {
			type: 'string',
			default: process.cwd(),
			defaultDescription: __( 'Current directory' ),
			description: __( 'Path to the WordPress files' ),
			coerce: ( value ) => path.resolve( process.cwd(), value ),
		} )
		.middleware( async ( argv ) => {
			if ( ! argv.avoidTelemetry ) {
				await bumpAggregatedUniqueStat(
					StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
					StatsMetric.SUCCESS,
					'weekly'
				);
			}
		} )
		.command( 'preview', __( 'Manage preview sites' ), ( previewYargs ) => {
			registerCreateCommand( previewYargs );
			registerListCommand( previewYargs );
			registerDeleteCommand( previewYargs );
			registerUpdateCommand( previewYargs );
			previewYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( 'sites', __( 'Manage local sites' ), ( sitesYargs ) => {
			registerSitesListCommand( sitesYargs );
			registerSitesCreateCommand( sitesYargs );
			sitesYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	await studioArgv.argv;
}

void main();
