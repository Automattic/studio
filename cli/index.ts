import { __ } from '@wordpress/i18n';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { version } from 'cli/package.json';
import { OutputFormat, StudioArgv } from 'cli/types';

async function main() {
	const locale = await loadTranslations();

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'Studio by WordPress.com CLI' ) )
		.locale( locale )
		.version( version )
		.option( 'output-format', {
			type: 'string',
			hidden: true,
			coerce: ( value: string ): OutputFormat => {
				if ( value !== 'json' ) {
					throw new Error( __( 'The only custom output format supported is "json"' ) );
				}
				return value;
			},
		} )
		.option( 'avoid-telemetry', {
			type: 'boolean',
			hidden: true,
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
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	await studioArgv.argv;
}

void main();
