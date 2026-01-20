import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../common/lib/extract-zip';

// Chrome extension IDs for React DevTools and Redux DevTools
const EXTENSIONS = {
	REACT_DEVELOPER_TOOLS: {
		id: 'fmkadmapgofadopljbjfkapdkoienihi',
		name: 'React Developer Tools',
	},
	REDUX_DEVTOOLS: {
		id: 'lmhkpmbekcpmknklioeibfkpmmfibljd',
		name: 'Redux DevTools',
	},
};

// Get the extensions directory path
// This matches the path used in src/index.ts:139
function getExtensionsPath(): string {
	const userDataPath =
		process.env.STUDIO_USER_DATA_PATH ||
		path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
	return path.join( userDataPath, 'extensions' );
}

// Download extension from Chrome Web Store
async function downloadExtension( extensionId: string, extensionName: string ): Promise< void > {
	const extensionsPath = getExtensionsPath();
	const extensionPath = path.join( extensionsPath, extensionId );

	// Check if extension already exists
	if ( fs.existsSync( extensionPath ) ) {
		console.log( `[${ extensionName }] Extension already installed, skipping download` );
		return;
	}

	console.log( `[${ extensionName }] Downloading extension...` );

	// Chrome Web Store download URL
	// This uses Google's extension update service to download the CRX file
	const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx2,crx3&x=id%3D${ extensionId }%26uc`;

	try {
		const response = await fetch( downloadUrl, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
			},
		} );

		if ( ! response.ok ) {
			throw new Error( `Failed to download extension: HTTP ${ response.status }` );
		}

		// Save CRX file to temp directory
		const crxPath = path.join( os.tmpdir(), `${ extensionId }.crx` );
		const buffer = Buffer.from( await response.arrayBuffer() );
		await fs.writeFile( crxPath, buffer );

		console.log( `[${ extensionName }] Extracting extension...` );

		// CRX files are ZIP files with a header. We need to find where the ZIP data starts.
		// The header format is: "Cr24" + version (4 bytes) + public key length (4 bytes) + signature length (4 bytes)
		const crxBuffer = await fs.readFile( crxPath );

		// Check for CRX3 format
		let zipStartOffset = 0;
		if ( crxBuffer.toString( 'utf8', 0, 4 ) === 'Cr24' ) {
			const version = crxBuffer.readUInt32LE( 4 );
			if ( version === 3 ) {
				// CRX3 format: header_size is at offset 8
				const headerSize = crxBuffer.readUInt32LE( 8 );
				zipStartOffset = 12 + headerSize;
			} else if ( version === 2 ) {
				// CRX2 format: public_key_length at offset 8, signature_length at offset 12
				const publicKeyLength = crxBuffer.readUInt32LE( 8 );
				const signatureLength = crxBuffer.readUInt32LE( 12 );
				zipStartOffset = 16 + publicKeyLength + signatureLength;
			}
		}

		// Extract just the ZIP portion
		const zipBuffer = crxBuffer.subarray( zipStartOffset );
		const zipPath = path.join( os.tmpdir(), `${ extensionId }.zip` );
		await fs.writeFile( zipPath, zipBuffer );

		// Create extension directory and extract
		await fs.ensureDir( extensionPath );
		await extractZip( zipPath, extensionPath );

		// Cleanup
		await fs.remove( crxPath );
		await fs.remove( zipPath );

		console.log( `[${ extensionName }] Extension installed successfully` );
	} catch ( error ) {
		console.error( `[${ extensionName }] Failed to download extension:`, error );
		// Don't exit with error - extensions are optional for development
		console.warn(
			`[${ extensionName }] Continuing without this extension. You can manually install it later.`
		);
	}
}

async function setupDevExtensions() {
	console.log( 'Setting up development extensions...' );
	console.log( `Extensions will be installed to: ${ getExtensionsPath() }` );

	for ( const extension of Object.values( EXTENSIONS ) ) {
		await downloadExtension( extension.id, extension.name );
	}

	console.log( 'Development extensions setup complete!' );
}

void setupDevExtensions();
