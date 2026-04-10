import path from 'node:path';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import yargs from 'yargs';
import { registerCommand as registerExportCommand } from 'cli/commands/export';
import { registerCommand as registerImportCommand } from 'cli/commands/import';
import { registerCommand as registerMcpCommand } from 'cli/commands/mcp';
import { registerCommand as registerPublishCommand } from 'cli/commands/publish';
import { registerCommand as registerPullCommand } from 'cli/commands/pull';
import { registerCommand as registerPushCommand } from 'cli/commands/push';
import {
	bumpAggregatedUniqueStat,
	bumpStat,
	getInstallTypeLaunchStatGroups,
	getPlatformMetric,
} from 'cli/lib/bump-stat';
import { setupServerFiles } from 'cli/lib/dependency-management/setup';
import { loadTranslations } from 'cli/lib/i18n';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

async function main() {
	const yargsLocale = await loadTranslations();

	if ( semver.lt( process.version, __MINIMUM_NODE_VERSION__ ) ) {
		console.error(
			sprintf(
				__(
					'Studio CLI requires Node.js %s or newer. You are running %s.\nUpgrade Node.js and run this command again.\nDownload: https://nodejs.org/en/download'
				),
				__MINIMUM_NODE_VERSION__,
				process.version
			)
		);
		process.exit( 1 );
	}

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
		.middleware( async () => {
			const { runMigrations } = await import( '@studio/common/lib/migration' );
			const { migrations } = await import( 'cli/migrations' );
			await runMigrations( migrations );
		} )
		.middleware( async ( argv ) => {
			if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
				const platformMetric = getPlatformMetric();
				const launchGroups = getInstallTypeLaunchStatGroups();

				bumpStat( launchGroups.totalLaunches, platformMetric );

				bumpAggregatedUniqueStat( launchGroups.firstLaunch, platformMetric, 'forever' ).catch( () =>
					console.error( 'Failed to bump stat:', launchGroups.firstLaunch )
				);

				// STUDIO_CLI_USAGE_UNIQUE and launchGroups.weeklyUnique are equivalent, apart from tracking
				// different metrics. For now, we keep both for backward compatibility.
				bumpAggregatedUniqueStat(
					StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
					StatsMetric.SUCCESS,
					'weekly'
				).catch( () =>
					console.error( 'Failed to bump stat:', StatsGroup.STUDIO_CLI_USAGE_UNIQUE )
				);

				bumpAggregatedUniqueStat( launchGroups.weeklyUnique, platformMetric, 'weekly' ).catch( () =>
					console.error( 'Failed to bump stat:', launchGroups.weeklyUnique )
				);

				bumpAggregatedUniqueStat( launchGroups.monthlyUnique, platformMetric, 'monthly' ).catch(
					() => console.error( 'Failed to bump stat:', launchGroups.monthlyUnique )
				);
			}
		} )
		.middleware( async () => {
			await setupServerFiles();
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
		} );

	const studioCodeCommandBuilder = async ( aiYargs: StudioArgv ) => {
		const { registerCommand: registerAiCommand } = await import( 'cli/commands/ai' );
		registerAiCommand( aiYargs );
		aiYargs.command( 'sessions', __( 'Manage code sessions' ), async ( sessionsYargs ) => {
			const [
				{ registerCommand: registerAiSessionsDeleteCommand },
				{ registerCommand: registerAiSessionsListCommand },
				{ registerCommand: registerAiSessionsResumeCommand },
			] = await Promise.all( [
				import( 'cli/commands/ai/sessions/delete' ),
				import( 'cli/commands/ai/sessions/list' ),
				import( 'cli/commands/ai/sessions/resume' ),
			] );

			sessionsYargs
				.option( 'path', {
					hidden: true,
				} )
				.option( 'session-persistence', {
					type: 'boolean',
					default: true,
					description: __( 'Record this code session to disk' ),
				} );
			registerAiSessionsDeleteCommand( sessionsYargs );
			registerAiSessionsListCommand( sessionsYargs );
			registerAiSessionsResumeCommand( sessionsYargs );
			sessionsYargs
				.version( false )
				.demandCommand( 1, __( 'You must provide a valid code sessions command' ) );
		} );
		aiYargs.version( false );
	};
	studioArgv.command(
		'code',
		__( 'AI agent for building WordPress sites' ),
		studioCodeCommandBuilder
	);
	studioArgv.command( 'ai', false, studioCodeCommandBuilder );

	registerExportCommand( studioArgv );
	registerImportCommand( studioArgv );
	registerMcpCommand( studioArgv );

	studioArgv.command( 'preview', __( 'Manage preview sites' ), async ( previewYargs ) => {
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
	} );

	registerPublishCommand( studioArgv );
	registerPullCommand( studioArgv );
	registerPushCommand( studioArgv );

	studioArgv
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
			registerImportCommand( studioArgv );
			registerExportCommand( studioArgv );

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
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	await studioArgv.argv;
}

void main();
