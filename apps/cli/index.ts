import path from 'node:path';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import yargs from 'yargs';
import { registerCommand as registerCheckpointCommand } from 'cli/commands/checkpoint';
import { registerCommand as registerExportCommand } from 'cli/commands/export';
import { registerCommand as registerImportCommand } from 'cli/commands/import';
import { registerCommand as registerMcpCommand } from 'cli/commands/mcp';
import { registerCommand as registerPullCommand } from 'cli/commands/pull';
import { registerCommand as registerPullReprintCommand } from 'cli/commands/pull-reprint';
import { registerCommand as registerPushCommand } from 'cli/commands/push';
import { registerCommand as registerSiteCreateCommand } from 'cli/commands/site/create';
import { registerCommand as registerSiteDeleteCommand } from 'cli/commands/site/delete';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { registerCommand as registerSiteScreenshotCommand } from 'cli/commands/site/screenshot';
import { registerCommand as registerSiteStartCommand } from 'cli/commands/site/start';
import { registerCommand as registerSiteStatusCommand } from 'cli/commands/site/status';
import { registerCommand as registerSiteStopCommand } from 'cli/commands/site/stop';
import { registerCommand as registerUiCommand } from 'cli/commands/ui';
import { registerCommand as registerUninstallCommand } from 'cli/commands/uninstall';
import {
	bumpAggregatedUniqueStat,
	bumpStat,
	getInstallTypeLaunchStatGroups,
	getPlatformMetric,
} from 'cli/lib/bump-stat';
import { setupServerFiles } from 'cli/lib/dependency-management/setup';
import { loadTranslations } from 'cli/lib/i18n';
import { setupTosNotice } from 'cli/lib/tos-notice';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { setupUpdateNotifier } from 'cli/lib/update-notifier';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

async function main() {
	await setupUpdateNotifier( version );

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

	await setupTosNotice();

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'WordPress Studio CLI' ) )
		.locale( yargsLocale )
		.version( version )
		.alias( 'v', 'version' )
		.alias( 'h', 'help' )
		.wrap( Math.min( 90, yargs().terminalWidth() ?? 90 ) )
		.option( 'avoid-telemetry', {
			type: 'boolean',
			hidden: true,
		} )
		.option( 'path', {
			type: 'string',
			alias: 'p',
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

			const { prunePmLogs } = await import( 'cli/lib/prune-pm-logs' );
			await prunePmLogs();
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
		const { registerRemoteSessionCommand } = await import( 'cli/commands/ai/remote-session' );
		registerRemoteSessionCommand( aiYargs );
		aiYargs.command(
			'sessions',
			__( 'List, resume, and delete code sessions' ),
			async ( sessionsYargs ) => {
				const [
					{ registerCommand: registerAiSessionsDeleteCommand },
					{ registerCommand: registerAiSessionsListCommand },
					{ registerCommand: registerAiSessionsResumeCommand },
				] = await Promise.all( [
					import( 'cli/commands/ai/sessions/delete' ),
					import( 'cli/commands/ai/sessions/list' ),
					import( 'cli/commands/ai/sessions/resume' ),
				] );

				sessionsYargs.option( 'path', {
					hidden: true,
				} );
				registerAiSessionsDeleteCommand( sessionsYargs );
				registerAiSessionsListCommand( sessionsYargs );
				registerAiSessionsResumeCommand( sessionsYargs );
				sessionsYargs
					.version( false )
					.demandCommand( 1, __( 'You must provide a valid code sessions command' ) );
			}
		);
		aiYargs
			.example( [
				[ 'studio code', __( 'Start an interactive chat with the AI agent' ) ],
				[
					'studio code "Create a portfolio site"',
					__( 'Start the agent with an initial message' ),
				],
				[
					'studio code --json "Add a contact page"',
					__( 'Run a single headless turn, printing NDJSON events' ),
				],
				[ 'studio code sessions list', __( 'List previous code sessions' ) ],
				[ 'studio code sessions resume latest', __( 'Resume the most recent session' ) ],
			] )
			.epilogue(
				[
					__(
						'Studio Code is an AI agent that builds WordPress sites: it creates and manages local and remote sites, builds themes, writes code, generates content, and publishes to WordPress.com.'
					),
					'',
					sprintf(
						/* translators: %s: Studio Code support documentation URL */
						__( 'Learn more: %s' ),
						'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/'
					),
				].join( '\n' )
			)
			.version( false );
	};
	studioArgv.command(
		'code',
		__( 'AI agent for building and managing WordPress sites' ),
		studioCodeCommandBuilder
	);
	studioArgv.command( 'ai', false, studioCodeCommandBuilder );

	// Site management verbs are exposed at the top level (e.g. `studio create`,
	// `studio start`, `studio list`). These used to live under the `site` group,
	// which is kept hidden below for backward compatibility.
	registerSiteCreateCommand( studioArgv );
	registerSiteListCommand( studioArgv );
	registerSiteStartCommand( studioArgv );
	registerSiteStopCommand( studioArgv );
	registerSiteDeleteCommand( studioArgv );
	registerSiteStatusCommand( studioArgv );
	registerSiteScreenshotCommand( studioArgv );

	registerPushCommand( studioArgv );
	registerPullCommand( studioArgv );
	if ( process.env.STUDIO_ENABLE_PULL_REPRINT ) {
		registerPullReprintCommand( studioArgv );
	}

	registerImportCommand( studioArgv );
	registerExportCommand( studioArgv );
	registerCheckpointCommand( studioArgv );

	registerUiCommand( studioArgv );
	registerUninstallCommand( studioArgv );

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

	// Per-site configuration lives under `config` (e.g. `studio config get php`,
	// `studio config set --php 8.3`).
	studioArgv.command( 'config', __( 'Manage site configuration' ), async ( configYargs ) => {
		const [
			{ registerCommand: registerConfigGetCommand },
			{ registerCommand: registerConfigSetCommand },
		] = await Promise.all( [
			import( 'cli/commands/config/get' ),
			import( 'cli/commands/config/set' ),
		] );

		registerConfigGetCommand( configYargs );
		registerConfigSetCommand( configYargs );
		configYargs
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid config command' ) );
	} );

	studioArgv.command( {
		command: 'wp',
		describe: __( 'WP-CLI' ),
		builder: ( wpYargs ) => {
			return wpYargs.help( false ).showHelpOnFail( false ).strict( false ).version( false );
		},
		handler: async ( argv ) => {
			const { commandHandler: wpCliCommandHandler } = await import( 'cli/commands/wp' );

			return wpCliCommandHandler( argv );
		},
	} );

	studioArgv.command( 'blueprint', __( 'Browse and use blueprints' ), async ( blueprintYargs ) => {
		const [
			{ registerCommand: registerBlueprintListCommand },
			{ registerCommand: registerBlueprintUseCommand },
		] = await Promise.all( [
			import( 'cli/commands/blueprint/list' ),
			import( 'cli/commands/blueprint/use' ),
		] );

		registerBlueprintListCommand( blueprintYargs );
		registerBlueprintUseCommand( blueprintYargs );
		blueprintYargs
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid blueprint command' ) );
	} );

	registerMcpCommand( studioArgv );

	studioArgv
		// Deprecated `site` group, kept hidden for backward compatibility. Every
		// subcommand is now available at the top level, and `site set` lives under
		// `config set`.
		.command( 'site', false, async ( sitesYargs ) => {
			const { registerCommand: registerSiteSetCommand } = await import( 'cli/commands/config/set' );

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
