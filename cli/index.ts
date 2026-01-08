import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { bumpAggregatedUniqueStat, AppdataProvider, LastBumpStatsData } from 'common/lib/bump-stat';
import { suppressPunycodeWarning } from 'common/lib/suppress-punycode-warning';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { disconnect } from 'cli/lib/pm2-manager';
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
import { registerCommand as registerSiteStopAllCommand } from 'cli/commands/site/stop-all';
import { commandHandler as wpCliCommandHandler } from 'cli/commands/wp';
import { readAppdata, lockAppdata, unlockAppdata, saveAppdata } from 'cli/lib/appdata';
import { loadTranslations } from 'cli/lib/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';
import { version } from '../package.json';

suppressPunycodeWarning();

// Handle shutdown message from parent process (Electron app).
// On Windows, child.kill() doesn't send SIGTERM, so we use IPC to notify
// the CLI to clean up (e.g., disconnect from PM2) before terminating.
// Only add this listener when running with IPC channel (from Electron app).
if ( process.send ) {
	process.on( 'message', ( message: unknown ) => {
		if ( message && typeof message === 'object' && 'type' in message && message.type === 'shutdown' ) {
			disconnect();
			process.exit( 0 );
		}
	} );
	// Allow the process to exit naturally when the main work is done,
	// even though we have a message listener. The IPC channel will be
	// cleaned up when the parent terminates.
	process.channel?.unref();
}

const cliAppdataProvider: AppdataProvider< LastBumpStatsData > = {
	load: readAppdata,
	lock: lockAppdata,
	unlock: unlockAppdata,
	save: async ( data ) => {
		// Cast is safe: data comes from readAppdata() which returns the full UserData type.
		// The lock/unlock is already handled by the caller (updateLastBump in common/lib/bump-stat.ts)
		// eslint-disable-next-line studio/require-lock-before-save
		await saveAppdata( data as never );
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
					await bumpAggregatedUniqueStat(
						StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
						StatsMetric.SUCCESS,
						'weekly',
						cliAppdataProvider
					);
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
		.command( 'site', __( 'Manage local sites' ), ( sitesYargs ) => {
			registerSiteStatusCommand( sitesYargs );
			registerSiteCreateCommand( sitesYargs );
			registerSiteListCommand( sitesYargs );
			registerSiteStartCommand( sitesYargs );
			registerSiteStopCommand( sitesYargs );
			registerSiteStopAllCommand( sitesYargs );
			registerSiteDeleteCommand( sitesYargs );
			registerSiteSetCommand( sitesYargs );
			sitesYargs.version( false ).demandCommand( 1, __( 'You must provide a valid command' ) );
		} )
		.command( {
			command: 'wp',
			describe: __( 'WP-CLI' ),
			builder: ( wpYargs ) => {
				return wpYargs.strict( false ).version( false );
			},
			handler: wpCliCommandHandler,
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	await studioArgv.argv;
}

void main();
