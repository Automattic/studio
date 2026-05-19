import { app, dialog, shell } from 'electron';
import nodePath from 'path';
import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { __ } from '@wordpress/i18n';
import fs from 'fs-extra';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { download } from 'src/lib/download';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow } from 'src/main-window';

function getImportBackupDeeplinkErrorMessage( error: unknown ): string {
	const errorMessage = ( error instanceof Error ? error.message : '' ).toLowerCase();

	const networkErrors = [ 'enotfound', 'econnrefused', 'etimedout', 'network' ];
	if ( networkErrors.some( ( err ) => errorMessage.includes( err ) ) ) {
		return __(
			'Could not connect to the server. Please check your internet connection and try again.'
		);
	}

	return __( 'Please check the link and try again.' );
}

function hasAcceptedExtension( fileName: string ): boolean {
	const lower = fileName.toLowerCase();
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) => lower.endsWith( ext ) );
}

function deriveFileNameFromUrl( rawUrl: string ): string {
	try {
		const pathname = new URL( rawUrl ).pathname;
		const candidate = pathname.split( '/' ).filter( Boolean ).pop();
		// If the URL exposes a filename with an extension, return it as-is so that
		// extension validation can reject unsupported types. Only fall back to a
		// default when the URL has no recognizable filename at all.
		if ( candidate && /\.[a-z0-9]+/i.test( candidate ) ) {
			return decodeURIComponent( candidate );
		}
	} catch {
		// Fall through to default.
	}
	return 'backup.zip';
}

/**
 * Handles the import-backup deeplink callback.
 * This function is called when a user clicks a deeplink like:
 * - wp-studio://import-backup?url=<encoded-url>
 * - wp-studio://import-backup?url=<encoded-url>&name=<filename>
 *
 * The backup file is downloaded to a temporary location, validated against the
 * accepted import extensions, and then the Add Site modal is opened with the
 * backup pre-selected on the "Import from a backup" step.
 */
export async function handleImportBackupDeeplink( urlObject: URL ): Promise< void > {
	const { searchParams } = urlObject;
	const backupUrl = searchParams.get( 'url' );
	const requestedName = searchParams.get( 'name' );

	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();

	if ( ! backupUrl ) {
		console.error( 'import-backup deeplink missing url parameter' );
		return;
	}

	const tmpDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-imports' );
	await fs.mkdir( tmpDir, { recursive: true } );

	let backupPath: string | undefined;

	try {
		// `URLSearchParams.get()` already returns the percent-decoded value, so
		// we parse `backupUrl` directly. Decoding it again would let an attacker
		// double-encode characters like `?` to shift the URL's query boundary
		// past any future allowlist check (the Apache CVE-2021-41773 shape).
		const parsedUrl = new URL( backupUrl );

		// Refuse non-HTTPS schemes outright. The deeplink can be triggered from
		// any web page / email / IM, so the inbound URL is attacker-controlled.
		// Allowing `http:` lets a network MITM swap the backup payload, and
		// backups contain PHP plugins/themes that Studio will execute via
		// WordPress Playground after import.
		if ( parsedUrl.protocol !== 'https:' ) {
			throw new Error(
				`Unsupported URL protocol "${ parsedUrl.protocol }". Only https: URLs are accepted for backup imports.`
			);
		}

		const fileName = requestedName?.trim() || deriveFileNameFromUrl( backupUrl );

		if ( ! hasAcceptedExtension( fileName ) ) {
			throw new Error(
				`Unsupported backup file extension for "${ fileName }". Supported: ${ ACCEPTED_IMPORT_FILE_TYPES.join(
					', '
				) }`
			);
		}

		const timestamp = Date.now();
		const safeBaseName = nodePath.basename( fileName ).replace( /[^\w.-]+/g, '_' );
		backupPath = nodePath.join( tmpDir, `import-${ timestamp }-${ safeBaseName }` );

		await download( backupUrl, backupPath, false, 'backup' );

		const stats = await fs.stat( backupPath );
		if ( ! stats.isFile() || stats.size === 0 ) {
			throw new Error( 'Downloaded backup file is empty or not a file' );
		}

		await sendIpcEventToRenderer( 'import-backup-from-deeplink', {
			backupPath,
			fileName: safeBaseName,
			fileSize: stats.size,
		} );
	} catch ( error ) {
		console.error( 'Failed to process backup from deeplink:', error );

		if ( backupPath ) {
			await fs.remove( backupPath ).catch( () => {
				// Ignore cleanup errors
			} );
		}

		const response = await dialog.showMessageBox( mainWindow, {
			type: 'error',
			message: __( 'Failed to import backup' ),
			detail: getImportBackupDeeplinkErrorMessage( error ),
			buttons: [ __( 'Open Studio Logs' ), __( 'OK' ) ],
			defaultId: 1,
		} );

		if ( response.response === 0 ) {
			const logFilePath = getLogsFilePath();
			const err = await shell.openPath( logFilePath );
			if ( err ) {
				console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
			}
		}
	}
}
