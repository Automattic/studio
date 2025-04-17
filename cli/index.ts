import { __ } from '@wordpress/i18n';
import { Command, Option } from 'commander';
import { StatsGroup, StatsMetric } from 'src/lib/bump-stats/types';
import { registerCommand as registerPreviewCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerPreviewDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerPreviewListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerPreviewUpdateCommand } from 'cli/commands/preview/update';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { version } from 'cli/package.json';

async function main() {
	await loadTranslations();

	const studioCommand = new Command();

	studioCommand
		.name( 'studio' )
		.description( __( 'Studio by WordPress.com CLI' ) )
		.version( version )
		.hook( 'preAction', () => {
			bumpAggregatedUniqueStat( StatsGroup.STUDIO_CLI_USAGE_UNIQUE, StatsMetric.SUCCESS, 'weekly' );
		} )
		.addOption(
			new Option( '--output-format [format]', __( 'Specify a non-standard output format' ) )
				.argParser( ( value: string ) => {
					if ( value !== 'json' ) {
						throw new Error( __( 'The only custom output format supported is "json"' ) );
					}
					return value;
				} )
				.hideHelp()
		);

	const previewCommand = studioCommand
		.command( 'preview' )
		.description( __( 'Manage preview sites' ) );

	registerPreviewCreateCommand( studioCommand );
	registerPreviewListCommand( previewCommand, studioCommand );
	registerPreviewDeleteCommand( previewCommand, studioCommand );
	registerPreviewUpdateCommand( previewCommand, studioCommand );

	studioCommand.parse( process.argv );
}

main();
