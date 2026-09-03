import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from './download-file';
import { extractZip } from './extract-zip';

const TEMP_DIR_PREFIX = 'studio-blueprint-bundle-';

function resolveBlueprintTempDir( tempDir: string ): string {
	const allowedPrefix = path.join( os.tmpdir(), TEMP_DIR_PREFIX );
	const resolvedDir = path.resolve( tempDir );
	if ( ! resolvedDir.startsWith( allowedPrefix ) ) {
		throw new Error( 'Invalid temp directory path' );
	}
	return resolvedDir;
}

/**
 * Creates a temp directory for blueprint operations. Use removeBlueprintTempDir()
 * to clean up — it validates the path prefix to prevent accidental deletions.
 */
export async function createBlueprintTempDir(): Promise< string > {
	return fs.promises.mkdtemp( path.join( os.tmpdir(), TEMP_DIR_PREFIX ) );
}

/**
 * Synchronous counterpart to createBlueprintTempDir(), for callers that assemble a
 * blueprint synchronously. Clean up with removeBlueprintTempDir().
 */
export function createBlueprintTempDirSync(): string {
	return fs.mkdtempSync( path.join( os.tmpdir(), TEMP_DIR_PREFIX ) );
}

/**
 * Downloads a blueprint bundle zip from a URL, extracts it to a temp directory,
 * and returns the path to the extracted blueprint.json.
 * Used for API blueprints that reference bundled resources (e.g. theme zips, WXR files).
 */
export async function downloadAndExtractBlueprintBundle( bundleUrl: string ): Promise< {
	blueprintJsonPath: string;
	tempDir: string;
} > {
	const tempDir = await createBlueprintTempDir();
	const tempZipPath = path.join( tempDir, 'bundle.zip' );

	try {
		await downloadFile( bundleUrl, tempZipPath );
		await extractZip( tempZipPath, tempDir );
		await fs.promises.unlink( tempZipPath ).catch( () => {} );

		// Find blueprint.json in the extracted contents
		let blueprintJsonPath = path.join( tempDir, 'blueprint.json' );
		try {
			await fs.promises.access( blueprintJsonPath );
		} catch {
			// Some zips have a single root directory — check one level deeper
			const files = await fs.promises.readdir( tempDir );
			for ( const file of files ) {
				const nestedPath = path.join( tempDir, file, 'blueprint.json' );
				try {
					await fs.promises.access( nestedPath );
					blueprintJsonPath = nestedPath;
					break;
				} catch {
					// continue checking
				}
			}
		}

		try {
			await fs.promises.access( blueprintJsonPath );
		} catch {
			throw new Error(
				'No blueprint.json found in the downloaded bundle. Ensure the bundle zip contains a blueprint.json.'
			);
		}

		return { blueprintJsonPath, tempDir };
	} catch ( error ) {
		await fs.promises.rm( tempDir, { recursive: true, force: true } ).catch( () => {} );
		throw error;
	}
}

export async function removeBlueprintTempDir( tempDir: string ): Promise< void > {
	await fs.promises.rm( resolveBlueprintTempDir( tempDir ), { recursive: true, force: true } );
}

export function removeBlueprintTempDirSync( tempDir: string ): void {
	fs.rmSync( resolveBlueprintTempDir( tempDir ), { recursive: true, force: true } );
}
