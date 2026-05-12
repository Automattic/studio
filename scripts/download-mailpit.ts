import fs from 'fs';
import os from 'os';
import path from 'path';
import { extract } from 'tar';
import { downloadFile } from '../tools/common/lib/download-file';
import { extractZip } from '../tools/common/lib/extract-zip';
import {
	getMailpitBinaryName,
	getMailpitInstallDirName,
	getMailpitReleaseAssetName,
	MAILPIT_VERSION,
} from '../tools/common/lib/mailpit';

const WP_FILES_PATH = path.join( __dirname, '..', 'wp-files' );
const platform = ( process.argv[ 2 ] || process.platform ) as NodeJS.Platform;
const arch = process.argv[ 3 ] || process.arch;

async function main(): Promise< void > {
	const assetName = getMailpitReleaseAssetName( platform, arch );
	const binaryName = getMailpitBinaryName( platform );
	const installDir = path.join(
		WP_FILES_PATH,
		'mailpit',
		getMailpitInstallDirName( platform, arch )
	);
	const destinationPath = path.join( installDir, binaryName );
	const url = `https://github.com/axllent/mailpit/releases/download/${ MAILPIT_VERSION }/${ assetName }`;
	const downloadPath = path.join( os.tmpdir(), `${ process.pid }-${ assetName }` );
	const extractDir = path.join( os.tmpdir(), `${ process.pid }-mailpit` );

	if ( fs.existsSync( destinationPath ) ) {
		console.log( `[mailpit] MailPit already exists at ${ destinationPath }` );
		return;
	}

	await fs.promises.mkdir( installDir, { recursive: true } );
	await fs.promises.mkdir( extractDir, { recursive: true } );

	try {
		console.log( `[mailpit] Downloading ${ assetName } ...` );
		await downloadFile( url, downloadPath );

		if ( assetName.endsWith( '.zip' ) ) {
			await extractZip( downloadPath, extractDir );
		} else {
			await extract( { file: downloadPath, cwd: extractDir } );
		}

		const extractedBinaryPath = path.join( extractDir, binaryName );
		if ( ! fs.existsSync( extractedBinaryPath ) ) {
			throw new Error( `MailPit binary not found in ${ assetName }` );
		}

		await fs.promises.copyFile( extractedBinaryPath, destinationPath );
		if ( platform !== 'win32' ) {
			await fs.promises.chmod( destinationPath, 0o755 );
		}

		console.log( `[mailpit] Installed ${ MAILPIT_VERSION } at ${ destinationPath }` );
	} finally {
		await fs.promises.rm( downloadPath, { force: true } ).catch( () => {} );
		await fs.promises.rm( extractDir, { recursive: true, force: true } ).catch( () => {} );
	}
}

void main().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );
