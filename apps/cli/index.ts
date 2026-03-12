import path from 'node:path';
import { __bumpAggregatedUniqueStat, ConfigFileProvider } from '@studio/common/lib/bump-stat';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __ } from '@wordpress/i18n';
import yargs from 'yargs';
import { commandHandler as eventsCommandHandler } from 'cli/commands/_events';
import { registerCommand as registerAiCommand } from 'cli/commands/ai';
import { registerCommand as registerAuthLoginCommand } from 'cli/commands/auth/login';
import { registerCommand as registerAuthLogoutCommand } from 'cli/commands/auth/logout';
import { registerCommand as registerAuthStatusCommand } from 'cli/commands/auth/status';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { registerCommand as registerSiteCreateCommand } from 'cli/commands/site/create';
import { registerCommand as registerSiteDeleteCommand } from 'cli/commands/site/delete';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { registerCommand as registerSiteSetCommand } from 'cli/commands/site/set';
import { registerCommand as registerSiteStartCommand } from 'cli/commands/site/start';
import { registerCommand as registerSiteStatusCommand } from 'cli/commands/site/status';
import { registerCommand as registerSiteStopCommand } from 'cli/commands/site/stop';
import { commandHandler as wpCliCommandHandler } from 'cli/commands/wp';
import { readAppdata, lockAppdata, unlockAppdata, saveAppdata } from 'cli/lib/appdata';
import { getPlatformMetric, StatsGroup, StatsMetric } from 'cli/lib/bump-stat';
import { loadTranslations } from 'cli/lib/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

const version = __STUDIO_CLI_VERSION__;

suppressPunycodeWarning();

const configFileProvider: ConfigFileProvider = {
	load: async () => {
		const { lastBumpStats } = await readAppdata();
		return lastBumpStats ?? {};
	},
	save: async ( lastBumpStats ) => {
		try {
			await lockAppdata();
			const appdata = await readAppdata();
			appdata.lastBumpStats = lastBumpStats;
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}
	},
};

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
			if ( ! argv.avoidTelemetry ) {
				try {
					await __bumpAggregatedUniqueStat(
						StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
						StatsMetric.SUCCESS,
						'weekly',
						configFileProvider
					);

					if ( __IS_PACKAGED_FOR_NPM__ ) {
						await __bumpAggregatedUniqueStat(
							StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_NPM,
							getPlatformMetric(),
							'weekly',
							configFileProvider
						);
					} else {
						await __bumpAggregatedUniqueStat(
							StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_APP,
							getPlatformMetric(),
							'weekly',
							configFileProvider
						);
					}
				} catch ( error ) {
					console.error( 'Failed to bump stat:', error );
				}
			}
		} )
		.command( 'auth', __( 'Manage authentication' ), ( authYargs ) => {
			registerAuthLoginCommand( authYargs );
			registerAuthLogoutCommand( authYargs );
			registerAuthStatusCommand( authYargs );
			authYargs.version( false ).demandCommand( 1, __( 'You must provide a valid auth command' ) );
		} )
		.command( 'preview', __( 'Manage preview sites' ), ( previewYargs ) => {
			registerCreateCommand( previewYargs );
			registerListCommand( previewYargs );
			registerDeleteCommand( previewYargs );
			registerUpdateCommand( previewYargs );
			previewYargs.version( false ).demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( 'site', __( 'Manage sites' ), ( sitesYargs ) => {
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
			handler: wpCliCommandHandler,
		} )
		.command( {
			command: '_events',
			describe: false, // Hidden command
			handler: eventsCommandHandler,
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	if ( process.env.ENABLE_STUDIO_AI === 'true' ) {
		registerAiCommand( studioArgv );
	}

	await studioArgv.argv;
}

void main();
