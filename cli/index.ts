import { __ } from '@wordpress/i18n';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
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

	const studioArgv: StudioArgv = yargs( hideBin( process.argv ) )
		.scriptName( 'studio' )
		.usage( __( 'Studio by WordPress.com CLI' ) )
		.locale( locale )
		.version( version )
		.middleware( () =>
			bumpAggregatedUniqueStat( StatsGroup.STUDIO_CLI_USAGE_UNIQUE, StatsMetric.SUCCESS, 'weekly' )
		)
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
		.command( 'preview', __( 'Manage preview sites' ), ( previewYargs ) => {
			registerCreateCommand( previewYargs );
			registerListCommand( previewYargs );
			registerDeleteCommand( previewYargs );
			registerUpdateCommand( previewYargs );
		} );

	await studioArgv.argv;
}

main();
