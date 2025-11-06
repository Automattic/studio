import 'cli/polyfills/browser-globals.js';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { suppressPunycodeWarning } from 'common/lib/suppress-punycode-warning';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { registerCommand as registerPm2ListCommand } from 'cli/commands/pm2/list';
import { registerCommand as registerPm2StartCommand } from 'cli/commands/pm2/start';
import { registerCommand as registerPm2StatusCommand } from 'cli/commands/pm2/status';
import { registerCommand as registerPm2StopCommand } from 'cli/commands/pm2/stop';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { registerCommand as registerProxyBootCommand } from 'cli/commands/proxy/boot';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { readAppdata } from 'cli/lib/appdata';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { version } from 'cli/package.json';
import { StudioArgv } from 'cli/types';

suppressPunycodeWarning();

async function main() {
	const locale = await loadTranslations();

	const studioArgv: StudioArgv = yargs( process.argv.slice( 2 ) )
		.scriptName( 'studio' )
		.usage( __( 'WordPress Studio CLI' ) )
		.locale( locale )
		.version( version )
		.option( 'avoid-telemetry', {
			type: 'boolean',
			hidden: true,
		} )
		.option( 'path', {
			type: 'string',
			default: process.cwd(),
			defaultDescription: __( 'Current directory' ),
			description: __( 'Path to the WordPress files' ),
			coerce: ( value ) => path.resolve( process.cwd(), value ),
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
		.command( {
			command: 'pm2',
			describe: __( 'Internal: PM2 daemon management (Studio use only)' ),
			hidden: true,
			builder: ( pm2Yargs ) => {
				registerPm2StartCommand( pm2Yargs );
				registerPm2StopCommand( pm2Yargs );
				registerPm2StatusCommand( pm2Yargs );
				registerPm2ListCommand( pm2Yargs );
				pm2Yargs.demandCommand( 1, __( 'You must provide a valid command' ) );
				return pm2Yargs;
			},
		} )
		.command( {
			command: 'proxy',
			describe: __( 'Internal: Proxy server management (Studio use only)' ),
			hidden: true,
			builder: ( proxyYargs ) => {
				registerProxyBootCommand( proxyYargs );
				proxyYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
				return proxyYargs;
			},
		} )
		.demandCommand( 1, __( 'You must provide a valid command' ) )
		.strict();

	// Check if Studio Sites CLI beta feature is enabled
	let isSitesCliEnabled = false;
	try {
		const appdata = await readAppdata();
		isSitesCliEnabled = appdata.betaFeatures?.studioSitesCli ?? false;
	} catch ( error ) {
		// If we can't read appdata, the feature is not enabled
		isSitesCliEnabled = false;
	}

	if ( isSitesCliEnabled ) {
		studioArgv.command( 'site', __( 'Manage local sites (Beta)' ), ( sitesYargs ) => {
			sitesYargs.option( 'path', {
				hidden: true,
			} );
			registerSiteListCommand( sitesYargs );
			sitesYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
		} );
	}

	await studioArgv.argv;
}

void main();
