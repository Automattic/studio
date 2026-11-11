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

/** Resolves the Blueprint while keeping its bundled resources beside it. */
export async function findBlueprintInBundle( directory: string ): Promise< string > {
	const rootPath = path.join( directory, 'blueprint.json' );
	if (
		await fs.promises.stat( rootPath ).then(
			( stat ) => stat.isFile(),
			() => false
		)
	) {
		return rootPath;
	}
	const entries = await fs.promises.readdir( directory, { withFileTypes: true } );
	const candidates: string[] = [];
	for ( const entry of entries ) {
		if ( ! entry.isDirectory() || entry.name === '__MACOSX' ) continue;
		const candidate = path.join( directory, entry.name, 'blueprint.json' );
		if (
			await fs.promises.stat( candidate ).then(
				( stat ) => stat.isFile(),
				() => false
			)
		) {
			candidates.push( candidate );
		}
	}
	if ( candidates.length !== 1 ) {
		throw new Error(
			candidates.length > 1
				? 'Multiple Blueprints found in the ZIP. Include only one Blueprint bundle.'
				: 'No blueprint.json found in the ZIP. Place it at the root or inside one enclosing folder.'
		);
	}
	return candidates[ 0 ];
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

		const blueprintJsonPath = await findBlueprintInBundle( tempDir );

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
