import path from 'node:path';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __ } from '@wordpress/i18n';
import yargs from 'yargs';
import { bumpAggregatedUniqueStat, getPlatformMetric } from 'cli/lib/bump-stat';
import { setupServerFiles } from 'cli/lib/dependency-management/setup';
import { loadTranslations } from 'cli/lib/i18n';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

async function main() {
	const yargsLocale = await loadTranslations();

	const studioAiArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio-ai' )
		.usage( __( 'AI-powered WordPress assistant' ) )
		.locale( yargsLocale )
		.version( version )
		.option( 'avoid-telemetry', {
			type: 'boolean',
			hidden: true,
		} )
		.option( 'path', {
			type: 'string',
			normalize: true,
			default: process.cwd(),
			defaultDescription: __( 'Current directory' ),
			description: __( 'Path to the WordPress files' ),
			coerce: ( value ) => {
				return path.resolve( untildify( value ) );
			},
		} )
		.middleware( async () => {
			const { runMigrations } = await import( '@studio/common/lib/migration' );
			const { migrations } = await import( 'cli/migrations' );
			await runMigrations( migrations );
		} )
		.middleware( async ( argv ) => {
			if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
				try {
					await bumpAggregatedUniqueStat(
						StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
						StatsMetric.SUCCESS,
						'weekly'
					);

					if ( __IS_PACKAGED_FOR_NPM__ ) {
						await bumpAggregatedUniqueStat(
							StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_NPM,
							getPlatformMetric(),
							'weekly'
						);
					} else {
						await bumpAggregatedUniqueStat(
							StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_APP,
							getPlatformMetric(),
							'weekly'
						);
					}
				} catch ( error ) {
					console.error( 'Failed to bump stat:', error );
				}
			}
		} )
		.middleware( async () => {
			await setupServerFiles();
		} );

	const { registerCommand: registerAiCommand } = await import( 'cli/commands/ai' );
	registerAiCommand( studioAiArgv );

	studioAiArgv.command( 'sessions', __( 'Manage AI sessions' ), async ( sessionsYargs ) => {
		const [
			{ registerCommand: registerAiSessionsListCommand },
			{ registerCommand: registerAiSessionsResumeCommand },
			{ registerCommand: registerAiSessionsDeleteCommand },
		] = await Promise.all( [
			import( 'cli/commands/ai/sessions/list' ),
			import( 'cli/commands/ai/sessions/resume' ),
			import( 'cli/commands/ai/sessions/delete' ),
		] );

		sessionsYargs
			.option( 'path', {
				hidden: true,
			} )
			.option( 'session-persistence', {
				type: 'boolean',
				default: true,
				description: __( 'Record this AI chat session to disk' ),
			} );
		registerAiSessionsListCommand( sessionsYargs );
		registerAiSessionsResumeCommand( sessionsYargs );
		registerAiSessionsDeleteCommand( sessionsYargs );
		sessionsYargs
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid ai sessions command' ) );
	} );

	await studioAiArgv.argv;
}

void main();
