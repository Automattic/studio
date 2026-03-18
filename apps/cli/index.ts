import path from 'node:path';
import { SharedConfigVersionMismatchError } from '@studio/common/lib/shared-config';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __ } from '@wordpress/i18n';
import yargs from 'yargs';
import { bumpAggregatedUniqueStat, getPlatformMetric } from 'cli/lib/bump-stat';
import { loadTranslations } from 'cli/lib/i18n';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

async function main() {
	const yargsLocale = await loadTranslations();

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'WordPress Studio CLI' ) )
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
		.command( 'auth', __( 'Manage authentication' ), async ( authYargs ) => {
			const [
				{ registerCommand: registerAuthLoginCommand },
				{ registerCommand: registerAuthLogoutCommand },
				{ registerCommand: registerAuthStatusCommand },
			] = await Promise.all( [
				import( 'cli/commands/auth/login' ),
				import( 'cli/commands/auth/logout' ),
				import( 'cli/commands/auth/status' ),
			] );

			registerAuthLoginCommand( authYargs );
			registerAuthLogoutCommand( authYargs );
			registerAuthStatusCommand( authYargs );
			authYargs.version( false ).demandCommand( 1, __( 'You must provide a valid auth command' ) );
		} )
		.command( 'preview', __( 'Manage preview sites' ), async ( previewYargs ) => {
			const [
				{ registerCommand: registerPreviewCreateCommand },
				{ registerCommand: registerPreviewListCommand },
				{ registerCommand: registerPreviewDeleteCommand },
				{ registerCommand: registerPreviewUpdateCommand },
				{ registerCommand: registerPreviewSetCommand },
			] = await Promise.all( [
				import( 'cli/commands/preview/create' ),
				import( 'cli/commands/preview/list' ),
				import( 'cli/commands/preview/delete' ),
				import( 'cli/commands/preview/update' ),
				import( 'cli/commands/preview/set' ),
			] );

			registerPreviewCreateCommand( previewYargs );
			registerPreviewListCommand( previewYargs );
			registerPreviewDeleteCommand( previewYargs );
			registerPreviewUpdateCommand( previewYargs );
			registerPreviewSetCommand( previewYargs );
			previewYargs.version( false ).demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( 'site', __( 'Manage sites' ), async ( sitesYargs ) => {
			const [
				{ registerCommand: registerSiteStatusCommand },
				{ registerCommand: registerSiteCreateCommand },
				{ registerCommand: registerSiteListCommand },
				{ registerCommand: registerSiteStartCommand },
				{ registerCommand: registerSiteStopCommand },
				{ registerCommand: registerSiteDeleteCommand },
				{ registerCommand: registerSiteSetCommand },
			] = await Promise.all( [
				import( 'cli/commands/site/status' ),
				import( 'cli/commands/site/create' ),
				import( 'cli/commands/site/list' ),
				import( 'cli/commands/site/start' ),
				import( 'cli/commands/site/stop' ),
				import( 'cli/commands/site/delete' ),
				import( 'cli/commands/site/set' ),
			] );

			registerSiteStatusCommand( sitesYargs );
			registerSiteCreateCommand( sitesYargs );
			registerSiteListCommand( sitesYargs );
			registerSiteStartCommand( sitesYargs );
			registerSiteStopCommand( sitesYargs );
			registerSiteDeleteCommand( sitesYargs );
			registerSiteSetCommand( sitesYargs );
			sitesYargs.version( false ).demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( {
			command: 'wp',
			describe: __( 'WP-CLI' ),
			builder: ( wpYargs ) => {
				return wpYargs
					.help( false )
					.showHelpOnFail( false )
					.strict( false )
					.version( false )
					.option( 'studio-no-path', {
						type: 'boolean',
						hidden: true,
					} );
			},
			handler: async ( argv ) => {
				const { commandHandler: wpCliCommandHandler } = await import( 'cli/commands/wp' );

				return wpCliCommandHandler( argv );
			},
		} )
		.command( {
			command: '_events',
			describe: false, // Hidden command
			handler: async () => {
				const { commandHandler: eventsCommandHandler } = await import( 'cli/commands/_events' );

				return eventsCommandHandler();
			},
		} )
		.fail( ( msg, err ) => {
			if ( err instanceof SharedConfigVersionMismatchError ) {
				console.error( `\n${ err.message }` );
				process.exit( 1 );
			}
			if ( msg ) {
				console.error( msg );
			}
			if ( err ) {
				throw err;
			}
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	if ( __ENABLE_STUDIO_AI__ ) {
		const { registerCommand: registerAiCommand } = await import( 'cli/commands/ai' );
		registerAiCommand( studioArgv );
	}
	if ( __ENABLE_AGENT_SUITE__ ) {
		const { registerCommand: registerMcpCommand } = await import( 'cli/commands/mcp' );
		registerMcpCommand( studioArgv );
	}

	await studioArgv.argv;
}

void main();
