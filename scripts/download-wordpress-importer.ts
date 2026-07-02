import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../packages/common/lib/extract-zip';
import { fetch } from './lib/with-retry';

// Pinned so builds are reproducible. Bump deliberately by editing this constant
// (and re-run `npm install` / the postinstall chain to re-download).
const WORDPRESS_IMPORTER_VERSION = '0.9.5';
const REPO_ZIP_URL = `https://downloads.wordpress.org/plugin/wordpress-importer.${ WORDPRESS_IMPORTER_VERSION }.zip`;

const WP_FILES_PATH = path.join( import.meta.dirname, '..', 'wp-files' );
const DESTINATION_PATH = path.join( WP_FILES_PATH, 'wordpress-importer' );

async function downloadWordPressImporter(): Promise< void > {
	console.log(
		`[wordpress-importer] Downloading wordpress-importer ${ WORDPRESS_IMPORTER_VERSION }...`
	);

	const zipPath = path.join( os.tmpdir(), 'wordpress-importer.zip' );
	const extractPath = path.join( os.tmpdir(), 'wordpress-importer-extracted' );

	const response = await fetch( REPO_ZIP_URL );
	if ( ! response.ok ) {
		throw new Error( `Failed to download wordpress-importer: ${ response.status }` );
	}
	const buffer = Buffer.from( await response.arrayBuffer() );
	await fs.writeFile( zipPath, buffer );

	await fs.remove( extractPath );
	await fs.ensureDir( extractPath );
	await extractZip( zipPath, extractPath );

	// The archive extracts to a top-level `wordpress-importer/` directory.
	const source = path.join( extractPath, 'wordpress-importer' );
	if ( ! ( await fs.pathExists( source ) ) ) {
		throw new Error( 'Could not find extracted wordpress-importer directory' );
	}

	await fs.remove( DESTINATION_PATH );
	await fs.ensureDir( WP_FILES_PATH );
	await fs.copy( source, DESTINATION_PATH );

	await fs.remove( zipPath );
	await fs.remove( extractPath );

	console.log( '[wordpress-importer] Done' );
}

downloadWordPressImporter().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
