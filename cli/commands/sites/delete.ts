import fs from 'fs';
import { confirm } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	readAppdata,
	saveAppdata,
	lockAppdata,
	unlockAppdata,
	getSiteByFolder,
} from 'cli/lib/appdata';
import { validateReadSitePath } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SiteData {
	id: string;
	name: string;
	path: string;
}

async function deleteSiteFromAppdata( siteId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		const updatedSites = userData.sites.filter( ( site ) => site.id !== siteId );
		const updatedNewSites = userData.newSites.filter( ( site ) => site.id !== siteId );

		await saveAppdata( {
			...userData,
			sites: updatedSites,
			newSites: updatedNewSites,
		} );
	} finally {
		await unlockAppdata();
	}
}

async function moveToTrash( filePath: string ): Promise< boolean > {
	try {
		// Try to use trash package for safe deletion
		const { default: trash } = await import( 'trash' );
		await trash( filePath );
		return true;
	} catch ( error ) {
		// Fallback: try to use fs.rm for deletion (less safe)
		try {
			await fs.promises.rm( filePath, { recursive: true, force: true } );
			return true;
		} catch ( rmError ) {
			console.warn( sprintf( __( 'Warning: Could not delete files at %s' ), filePath ) );
			return false;
		}
	}
}

async function deleteSite( siteData: SiteData, deleteFiles: boolean ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.APPDATA, __( 'Deleting site...' ) );

		// Delete from appdata
		await deleteSiteFromAppdata( siteData.id );

		// Delete files if requested
		if ( deleteFiles ) {
			const filesDeleted = await moveToTrash( siteData.path );
			if ( filesDeleted ) {
				logger.reportSuccess( sprintf( __( 'Site files moved to trash' ) ) );
			}
		}

		logger.reportSuccess( sprintf( __( 'Site "%s" deleted successfully' ), siteData.name ) );
		console.log( __( '\nUse "studio sites list" to see your remaining sites.' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to delete site' ), error );
			logger.reportError( loggerError );
		}
		throw error;
	}
}

export async function runCommand( sitePath: string ): Promise< void > {
	try {
		console.log( __( 'Delete site from Studio' ) );
		console.log( __( 'Press Ctrl+C to cancel at any time.\n' ) );

		// Validate site path
		const pathValidation = validateReadSitePath( sitePath );
		if ( ! pathValidation.valid ) {
			throw new LoggerError( pathValidation.error! );
		}

		// Find site in appdata
		const siteData = await getSiteByFolder( sitePath );

		// Show site details
		console.log( __( 'Site details:' ) );
		console.log( sprintf( __( '  Name: %s' ), siteData.name ) );
		console.log( sprintf( __( '  Path: %s' ), siteData.path ) );
		console.log( sprintf( __( '  ID: %s' ), siteData.id ) );
		console.log();

		// Confirm deletion
		const confirmDelete = await confirm( {
			message: __( '⚠️  Are you sure you want to delete this site?' ),
			default: false,
		} );

		if ( ! confirmDelete ) {
			console.log( __( 'Operation cancelled.' ) );
			return;
		}

		// Ask about file deletion
		const deleteFiles = await confirm( {
			message: __( '⚠️  Do you want to delete all site files? This will move them to trash.' ),
			default: false,
		} );

		await deleteSite( siteData, deleteFiles );
	} catch ( error ) {
		if ( error && typeof error === 'object' && 'isTTYError' in error ) {
			console.error( __( 'This command requires an interactive terminal' ) );
			process.exit( 1 );
		}

		if ( error instanceof LoggerError ) {
			console.error( error.message );
			process.exit( 1 );
		}

		console.error( __( 'An unexpected error occurred:' ), error );
		process.exit( 1 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete',
		describe: __( 'Delete a site from Studio' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
