import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { bumpAggregatedUniqueStat, AppdataProvider, LastBumpStatsData } from 'common/lib/bump-stat';
import { suppressPunycodeWarning } from 'common/lib/suppress-punycode-warning';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { registerCommand as registerAuthLoginCommand } from 'cli/commands/auth/login';
import { registerCommand as registerAuthLogoutCommand } from 'cli/commands/auth/logout';
import { registerCommand as registerAuthStatusCommand } from 'cli/commands/auth/status';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { readAppdata, lockAppdata, unlockAppdata, saveAppdata } from 'cli/lib/appdata';
import { loadTranslations } from 'cli/lib/i18n';
import { version } from 'cli/package.json';
import { StudioArgv } from 'cli/types';

suppressPunycodeWarning();

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
			default: process.cwd(),
			defaultDescription: __( 'Current directory' ),
			description: __( 'Path to the WordPress files' ),
			coerce: ( value ) => path.resolve( process.cwd(), value ),
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
			authYargs.demandCommand( 1, __( 'You must provide a valid auth command' ) );
		} )
		.command( 'preview', __( 'Manage preview sites' ), ( previewYargs ) => {
			registerCreateCommand( previewYargs );
			registerListCommand( previewYargs );
			registerDeleteCommand( previewYargs );
			registerUpdateCommand( previewYargs );
			previewYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
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
			registerSiteListCommand( sitesYargs );
			sitesYargs.demandCommand( 1, __( 'You must provide a valid command' ) );
		} );
	}

	await studioArgv.argv;
}

void main();
