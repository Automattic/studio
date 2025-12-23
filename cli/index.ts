import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { suppressPunycodeWarning } from 'common/lib/suppress-punycode-warning';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import yargs from 'yargs';
import { registerCommand as registerAuthLoginCommand } from 'cli/commands/auth/login';
import { registerCommand as registerAuthLogoutCommand } from 'cli/commands/auth/logout';
import { registerCommand as registerAuthStatusCommand } from 'cli/commands/auth/status';
import { registerCommand as registerTelexBlockCommand } from 'cli/commands/telex/block';
import { registerCommand as registerTelexInstallCommand } from 'cli/commands/telex/install';
import { registerCommand as registerCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerUpdateCommand } from 'cli/commands/preview/update';
import { registerCommand as registerSiteCreateCommand } from 'cli/commands/site/create';
import { registerCommand as registerSiteDeleteCommand } from 'cli/commands/site/delete';
import { registerCommand as registerSiteListCommand } from 'cli/commands/site/list';
import { registerCommand as registerSiteSetDomainCommand } from 'cli/commands/site/set-domain';
import { registerCommand as registerSiteSetHttpsCommand } from 'cli/commands/site/set-https';
import { registerCommand as registerSiteSetPhpVersionCommand } from 'cli/commands/site/set-php-version';
import { registerCommand as registerSiteSetWpVersionCommand } from 'cli/commands/site/set-wp-version';
import { registerCommand as registerSiteStartCommand } from 'cli/commands/site/start';
import { registerCommand as registerSiteStatusCommand } from 'cli/commands/site/status';
import { registerCommand as registerSiteStopCommand } from 'cli/commands/site/stop';
import { registerCommand as registerSiteStopAllCommand } from 'cli/commands/site/stop-all';
import { commandHandler as wpCliCommandHandler } from 'cli/commands/wp';
import { loadTranslations } from 'cli/lib/i18n';
import { bumpAggregatedUniqueStat } from 'cli/lib/stats';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';
import { version } from '../package.json';

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
			if ( ! argv.avoidTelemetry ) {
				await bumpAggregatedUniqueStat(
					StatsGroup.STUDIO_CLI_USAGE_UNIQUE,
					StatsMetric.SUCCESS,
					'weekly'
				);
			}
		} )
		.command( 'auth', __( 'Manage authentication' ), ( authYargs ) => {
			registerAuthLoginCommand( authYargs );
			registerAuthLogoutCommand( authYargs );
			registerAuthStatusCommand( authYargs );
			authYargs.version( false ).demandCommand( 1, __( 'You must provide a valid auth command' ) );
		} )
		.command( 'telex', __( 'AI-assisted block development with Telex' ), ( telexYargs ) => {
			registerTelexBlockCommand( telexYargs );
			registerTelexInstallCommand( telexYargs );
			telexYargs.demandCommand( 1, __( 'You must provide a valid telex command' ) );
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
			registerSiteSetHttpsCommand( sitesYargs );
			registerSiteSetDomainCommand( sitesYargs );
			registerSiteSetPhpVersionCommand( sitesYargs );
			registerSiteSetWpVersionCommand( sitesYargs );
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
