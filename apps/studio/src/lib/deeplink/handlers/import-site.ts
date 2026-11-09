import { dialog, shell } from 'electron';
import os from 'os';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { __ } from '@wordpress/i18n';
import { https } from 'follow-redirects';
import fs from 'fs-extra';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getLogsFilePath } from 'src/logging';
import { isAllowedBackupUrl } from '../studio-action-link';
import type { StudioAction } from '../studio-action-link';
import type { BrowserWindow } from 'electron';

const MAX_BYTES = 1024 * 1024 * 1024;
// One linked backup is offered at a time, so each link replaces the previous download.
const DOWNLOAD_DIR = path.join( os.tmpdir(), 'wp-studio-import-site' );

export async function downloadBackup( url: string, destination: string ): Promise< void > {
	if ( ! isAllowedBackupUrl( url ) ) throw new Error( 'Unsupported backup URL' );
	await new Promise< void >( ( resolve, reject ) => {
		const request = https.get(
			url,
			{
				maxRedirects: 5,
				beforeRedirect: ( options ) => {
					if ( options.protocol !== 'https:' ) throw new Error( 'Insecure backup redirect' );
				},
			},
			( response ) => {
				if (
					response.statusCode !== 200 ||
					Number( response.headers[ 'content-length' ] ) > MAX_BYTES
				) {
					response.destroy();
					reject( new Error( 'Backup download rejected' ) );
					return;
				}
				let size = 0;
				const limit = new Transform( {
					transform( chunk: Buffer, _encoding, callback ) {
						size += chunk.length;
						callback( size > MAX_BYTES ? new Error( 'Backup exceeds 1 GB' ) : null, chunk );
					},
				} );
				void pipeline( response, limit, fs.createWriteStream( destination, { flags: 'wx' } ) ).then(
					resolve,
					reject
				);
			}
		);
		request.on( 'error', reject );
		request.setTimeout( 60_000, () => request.destroy( new Error( 'Backup download timed out' ) ) );
	} );
}

export async function handleImportSite(
	target: Extract< StudioAction, { action: 'import-site' } >,
	window: BrowserWindow
): Promise< void > {
	try {
		await fs.emptyDir( DOWNLOAD_DIR );
		const downloadPath = path.join( DOWNLOAD_DIR, 'download' );
		await downloadBackup( target.url, downloadPath );
		const magic = Buffer.alloc( 4 );
		const file = await fs.open( downloadPath, 'r' );
		try {
			await fs.read( file, magic, 0, 4, 0 );
		} finally {
			await fs.close( file );
		}
		const extension = magic.equals( Buffer.from( [ 0x50, 0x4b, 3, 4 ] ) )
			? '.zip'
			: magic[ 0 ] === 0x1f && magic[ 1 ] === 0x8b && magic[ 2 ] === 8
			? '.tar.gz'
			: null;
		if ( ! extension ) throw new Error( 'Not a zip or tar.gz backup' );
		const stem =
			( target.name ?? 'Imported site' )
				.replace( /\.(zip|tar\.gz)$/i, '' )
				.replace( /[^a-zA-Z0-9._-]/g, '_' )
				.replace( /^\.+/, '' )
				.slice( 0, 180 ) || 'Imported site';
		const name = `${ stem }${ extension }`;
		const backupPath = path.join( DOWNLOAD_DIR, name );
		await fs.rename( downloadPath, backupPath );
		await sendIpcEventToRenderer( 'add-site', { backup: { path: backupPath, name } } );
	} catch ( error ) {
		console.error( 'Failed to import backup link:', error );
		await fs.remove( DOWNLOAD_DIR );
		const result = await dialog.showMessageBox( window, {
			type: 'error',
			message: __( 'WordPress Studio could not download this backup.' ),
			detail: __(
				'Use an HTTPS backup link from a supported site, with a zip or tar.gz file smaller than 1 GB. Check your connection and try again.'
			),
			buttons: [ __( 'Open WordPress Studio Logs' ), __( 'OK' ) ],
			defaultId: 1,
		} );
		if ( result.response === 0 ) await shell.openPath( getLogsFilePath() );
	}
}
