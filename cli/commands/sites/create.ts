import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { input, select, Separator } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import { portFinder } from 'common/lib/port-finder';
import {
	DEFAULT_PHP_VERSION,
	ALLOWED_PHP_VERSIONS,
	DEFAULT_WORDPRESS_VERSION,
} from 'common/lib/wordpress-provider/constants';
import { setupWordPressSite } from 'common/lib/wordpress-setup';
import { getGroupedWordPressVersions } from 'common/lib/wp-org/version-groups';
import { fetchWordPressVersions } from 'common/lib/wp-org/versions';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { validateCreateSitePath } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { storagePaths } from 'cli/storage/paths';
import { StudioArgv } from 'cli/types';

interface SiteCreationData {
	name: string;
	path: string;
	phpVersion: string;
	wpVersion: string;
}

async function getWordPressVersionChoices() {
	try {
		const versions = await fetchWordPressVersions();
		const groups = getGroupedWordPressVersions( versions );
		const choices: ( { name: string; value: string } | Separator )[] = [];
		groups.forEach( ( group ) => {
			if ( group.versions.length > 0 ) {
				choices.push( new Separator( `─── ${ group.label } ───` ) );
				group.versions.forEach( ( v ) => {
					choices.push( { name: v.label, value: v.value } );
				} );
			}
		} );

		return { choices, useSelect: true };
	} catch ( error ) {
		return { choices: null, useSelect: false };
	}
}

function generateSiteNameFromPath( sitePath: string ): string {
	const folderName = path.basename( path.resolve( sitePath ) );

	// Convert folder name to a readable site name
	// First handle camelCase by inserting spaces before uppercase letters
	const withSpaces = folderName.replace( /([a-z])([A-Z])/g, '$1 $2' );

	// Then split on hyphens, underscores, and spaces
	return withSpaces
		.split( /[-_\s]+/ )
		.filter( ( word ) => word.length > 0 ) // Remove empty strings
		.map( ( word ) => word.charAt( 0 ).toUpperCase() + word.slice( 1 ).toLowerCase() ) // Capitalize each word
		.join( ' ' ); // Join with spaces
}

async function promptForSiteData(): Promise< SiteCreationData > {
	const sitePath = await input( {
		message: __( 'Site path:' ),
		default: process.cwd(),
		validate: async ( inputPath: string ) => {
			return validateCreateSitePath( inputPath ).valid;
		},
	} );

	const siteName = await input( {
		message: __( 'Site name:' ),
		default: generateSiteNameFromPath( sitePath ),
	} );

	const phpVersion = await select( {
		message: __( 'PHP version:' ),
		choices: ALLOWED_PHP_VERSIONS.map( ( version ) => ( {
			name: version,
			value: version,
		} ) ),
		default: DEFAULT_PHP_VERSION,
	} );

	const wordPressVersionData = await getWordPressVersionChoices();
	let wpVersion;
	if ( wordPressVersionData.useSelect && wordPressVersionData.choices ) {
		wpVersion = await select( {
			message: __( 'WordPress version:' ),
			choices: wordPressVersionData.choices,
			default: DEFAULT_WORDPRESS_VERSION,
		} );
	} else {
		wpVersion = await input( {
			message: __( 'WordPress version:' ),
			default: DEFAULT_WORDPRESS_VERSION,
		} );
	}

	return {
		name: siteName,
		path: sitePath,
		phpVersion,
		wpVersion,
	};
}

async function createSite( siteData: SiteCreationData ): Promise< void > {
	const logger = new Logger< LoggerAction >();
	const resolvedPath = path.resolve( siteData.path );

	try {
		logger.reportStart( LoggerAction.APPDATA, __( 'Creating site...' ) );

		const siteId = crypto.randomUUID();
		const port = await portFinder.getOpenPort();

		const siteEntry = {
			id: siteId,
			name: siteData.name,
			path: resolvedPath,
			port,
			phpVersion: siteData.phpVersion,
			running: false,
			isWpAutoUpdating: false,
		};

		if ( ! fs.existsSync( resolvedPath ) ) {
			fs.mkdirSync( resolvedPath, { recursive: true } );
		}

		// Setup WordPress files in the site directory
		logger.reportStart( LoggerAction.APPDATA, __( 'Setting up WordPress files...' ) );
		await setupWordPressSite( {
			sitePath: resolvedPath,
			wpVersion: siteData.wpVersion,
			serverFilesPath: storagePaths.getServerFilesPath(),
		} );

		await lockAppdata();
		const appdata = await readAppdata();
		appdata.sites.push( siteEntry );
		await saveAppdata( appdata );

		logger.reportSuccess( sprintf( __( 'Site "%s" created successfully' ), siteData.name ) );
		console.log( __( '\nSite details:' ) );
		console.log( sprintf( __( '  Name: %s' ), siteData.name ) );
		console.log( sprintf( __( '  Path: %s' ), resolvedPath ) );
		console.log( sprintf( __( '  WordPress Version: %s' ), siteData.wpVersion ) );
		console.log( sprintf( __( '  PHP Version: %s' ), siteData.phpVersion ) );
		console.log( sprintf( __( '  Port: %d' ), port ) );
		console.log( sprintf( __( '  ID: %s' ), siteEntry.id ) );

		console.log( __( '\nUse "studio sites list" to see all your sites.' ) );
	} catch ( error ) {
		// Clean up the directory if WordPress setup failed
		if ( fs.existsSync( resolvedPath ) ) {
			fs.rmSync( resolvedPath, { recursive: true, force: true } );
		}
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create site' ), error );
			logger.reportError( loggerError );
		}
		throw error;
	} finally {
		await unlockAppdata();
	}
}

export async function runCommand(): Promise< void > {
	try {
		console.log( __( 'Create a new WordPress site' ) );
		console.log( __( 'Press Ctrl+C to cancel at any time.\n' ) );

		const siteData = await promptForSiteData();
		await createSite( siteData );
	} catch ( error ) {
		if ( error && typeof error === 'object' && 'isTTYError' in error ) {
			console.error( __( 'This command requires an interactive terminal' ) );
			process.exit( 1 );
		}
		throw error;
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site interactively' ),
		handler: runCommand,
	} );
};
