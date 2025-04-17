import { __ } from '@wordpress/i18n';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs, { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { registerPreviewCommands } from 'cli/commands/preview';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { version } from 'cli/package.json';
import { GlobalOptions, OutputFormat } from 'cli/types';

async function main() {
	await loadTranslations();

	const argv: Argv< GlobalOptions > = yargs( hideBin( process.argv ) )
		.scriptName( 'studio' )
		.usage( __( 'Studio by WordPress.com CLI' ) )
		.version( version )
		.middleware( async () =>
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
		} );

	registerPreviewCommands( argv ).strict().help();

	await argv.argv;
}

main();
