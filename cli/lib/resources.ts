import path from 'path';
import { pathExists } from 'common/lib/fs-utils';
import { downloadFiles, getWordPressResourceFiles } from 'common/lib/resource-downloader';
import { storagePaths } from 'cli/storage/paths';

/**
 * Check if all required WordPress resources are available locally
 */
async function resourcesExist(): Promise< boolean > {
	const serverFilesPath = storagePaths.getServerFilesPath();

	const wordpressPath = path.join( serverFilesPath, 'latest', 'wordpress' );
	const sqlitePath = path.join( serverFilesPath, 'sqlite-database-integration' );
	const wpCliPath = path.join( serverFilesPath, 'wp-cli.phar' );

	return (
		( await pathExists( wordpressPath ) ) &&
		( await pathExists( sqlitePath ) ) &&
		( await pathExists( wpCliPath ) )
	);
}

/**
 * Download all WordPress resources to server files directory
 */
async function downloadAllResources(): Promise< void > {
	const serverFilesPath = storagePaths.getServerFilesPath();
	const files = getWordPressResourceFiles( serverFilesPath );

	try {
		await downloadFiles( files, serverFilesPath, { silent: true } );
	} catch ( error ) {
		throw new Error( `Failed to download WordPress resources: ${ ( error as Error ).message }` );
	}
}

/**
 * Ensure WordPress resources are available for CLI operation
 * This is a mandatory requirement - CLI will not work without resources
 */
export async function ensureResourcesAvailable(): Promise< void > {
	if ( await resourcesExist() ) {
		return;
	}

	console.log( `
🚀 Welcome to WordPress Studio CLI!

Setting the CLI...
This is a one-time setup that downloads essential WordPress files:

📦 WordPress (latest version)
🔧 SQLite Database Integration  
⚡ WP-CLI tools

Files will be cached locally for offline use.
This may take a minute...
` );

	try {
		await downloadAllResources();
		console.log( `
✅ Setup complete! WordPress Studio CLI is ready to use.
` );
	} catch ( error ) {
		console.error( `
❌ Setup failed: Unable to download WordPress resources.

WordPress Studio CLI requires internet connection for first-time setup.
Please check your connection and try again.

Error: ${ ( error as Error ).message }
` );
		process.exit( 1 ); // Hard fail - CLI won't work without resources
	}
}
