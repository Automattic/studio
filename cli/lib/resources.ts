import path from 'path';
import { pathExists } from 'common/lib/fs-utils';
import { downloadFiles, getWordPressResourceFiles } from 'common/lib/resource-downloader';
import { storagePaths } from 'cli/storage/paths';

/**
 * Check if all required WordPress resources are available locally
 */
async function resourcesExist(): Promise< boolean > {
	const resourcesPath = storagePaths.getResourcesPath();
	const wpFilesPath = path.join( resourcesPath, 'wp-files' );

	// Check for essential WordPress files
	const wordpressPath = path.join( wpFilesPath, 'latest', 'wordpress' );
	const sqlitePath = path.join( wpFilesPath, 'sqlite-database-integration' );
	const wpCliPath = path.join( wpFilesPath, 'wp-cli', 'wp-cli.phar' );

	return (
		( await pathExists( wordpressPath ) ) &&
		( await pathExists( sqlitePath ) ) &&
		( await pathExists( wpCliPath ) )
	);
}

/**
 * Download all WordPress resources to CLI resources directory
 */
async function downloadAllResources(): Promise< void > {
	const resourcesPath = storagePaths.getResourcesPath();
	const wpFilesPath = path.join( resourcesPath, 'wp-files' );

	const files = getWordPressResourceFiles( wpFilesPath );

	// Download files sequentially with error handling
	try {
		await downloadFiles( files, wpFilesPath, { silent: true } );
	} catch ( error ) {
		// Re-throw with more context
		throw new Error( `Failed to download WordPress resources: ${ ( error as Error ).message }` );
	}
}

/**
 * Ensure WordPress resources are available for CLI operation
 * This is a mandatory requirement - CLI will not work without resources
 */
export async function ensureResourcesAvailable(): Promise< void > {
	// Fast check - return immediately if resources exist
	if ( await resourcesExist() ) {
		return;
	}

	// Show comprehensive setup message
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
