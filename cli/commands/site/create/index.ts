import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { type SupportedPHPVersion } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { Blueprint } from '@wp-playground/blueprints';
import { RecommendedPHPVersion } from '@wp-playground/common';
import {
	filterUnsupportedBlueprintFeatures,
	validateBlueprintData,
} from 'common/lib/blueprint-validation';
import { getDomainNameValidationError } from 'common/lib/domains';
import { arePathsEqual, isEmptyDir, isWordPressDirectory, pathExists } from 'common/lib/fs-utils';
import { createPassword } from 'common/lib/passwords';
import { portFinder } from 'common/lib/port-finder';
import { sortSites } from 'common/lib/sort-sites';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { blueprintValidator } from 'cli/commands/site/create/validators/blueprint';
import { phpVersionValidator } from 'cli/commands/site/create/validators/php-version';
import { wpVersionValidator } from 'cli/commands/site/create/validators/wp-version';
import { lockAppdata, readAppdata, saveAppdata, SiteData, unlockAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { installSqliteIntegration, isSqliteIntegrationAvailable } from 'cli/lib/sqlite-integration';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const DEFAULT_VERSIONS = {
	php: RecommendedPHPVersion,
	wp: 'latest',
} as const;

const logger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	options: {
		name?: string;
		wpVersion: string;
		phpVersion: SupportedPHPVersion;
		customDomain?: string;
		enableHttps: boolean;
		blueprintJson?: unknown;
		noStart: boolean;
	}
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration...' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprint: Blueprint | undefined;
		if ( options.blueprintJson ) {
			const validation = await validateBlueprintData( options.blueprintJson );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			for ( const warning of validation.warnings ) {
				logger.reportWarning(
					sprintf(
						/* translators: %1$s: feature name, %2$s: reason */
						__( `Blueprint feature "%1$s" is not supported: %2$s` ),
						warning.feature,
						warning.reason
					)
				);
			}

			blueprint = filterUnsupportedBlueprintFeatures( options.blueprintJson ) as Blueprint;
		}

		const appdata = await readAppdata();
		if ( appdata.sites.some( ( site ) => arePathsEqual( site.path, sitePath ) ) ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of appdata.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = appdata.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory...' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		if ( ! ( await isSqliteIntegrationAvailable() ) ) {
			throw new LoggerError(
				__(
					'SQLite integration files not found. Please ensure Studio Desktop is installed and has been run at least once.'
				)
			);
		}
		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration...' ) );
		await installSqliteIntegration( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port...' ) );
		const port = await portFinder.getOpenPort();
		logger.reportSuccess( __( 'Port assigned: ' ) + port );

		const siteName = options.name || path.basename( sitePath );
		const siteId = crypto.randomUUID();
		const adminPassword = createPassword();

		if ( options.name ) {
			if ( ! blueprint ) {
				blueprint = {};
			}
			const existingSteps = blueprint.steps || [];
			blueprint.steps = [
				{
					step: 'setSiteOptions',
					options: {
						blogname: options.name,
					},
				},
				...existingSteps,
			];
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminPassword,
			port,
			phpVersion: options.phpVersion,
			running: false,
			isWpAutoUpdating: options.wpVersion === DEFAULT_VERSIONS.wp,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site...' ) );

		try {
			await lockAppdata();
			const userData = await readAppdata();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveAppdata( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockAppdata();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
			await connect();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress site and applying blueprint...' )
				: __( 'Starting WordPress site...' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, { wpVersion: options.wpVersion, blueprint } );
				logger.reportSuccess( __( 'WordPress site started' ) );

				logSiteDetails( siteDetails );
				await openSiteInBrowser( siteDetails );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to start WordPress server' ), error );
			}
		} else if ( blueprint ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
			await connect();
			logger.reportSuccess( __( 'Process daemon started' ) );

			logger.reportStart( LoggerAction.START_SITE, __( 'Applying blueprint...' ) );
			try {
				await runBlueprint( siteDetails, { wpVersion: options.wpVersion, blueprint } );
				logger.reportSuccess( __( 'Blueprint applied successfully' ) );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to apply blueprint' ), error );
			}

			console.log( '' );
			console.log( __( 'Site created successfully!' ) );
			console.log( '' );
			logSiteDetails( siteDetails );
			console.log( __( 'Run "studio site start" to start the site.' ) );
		} else {
			console.log( '' );
			console.log( __( 'Site created successfully!' ) );
			console.log( '' );
			logSiteDetails( siteDetails );
			console.log( __( 'Run "studio site start" to start the site.' ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new local site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					default: DEFAULT_VERSIONS.wp,
					coerce: wpVersionValidator,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					default: DEFAULT_VERSIONS.php,
					coerce: phpVersionValidator,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					default: false,
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path to blueprint JSON file' ),
					coerce: blueprintValidator,
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, {
					name: argv.name,
					wpVersion: argv.wp,
					phpVersion: argv.php,
					customDomain: argv.domain,
					enableHttps: argv.https,
					blueprintJson: argv.blueprint,
					noStart: ! argv.start,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to load site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
