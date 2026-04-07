import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { z } from 'zod';

export async function downloadFile( url: string, destinationPath: string ): Promise< void > {
	try {
		await fs.promises.mkdir( path.dirname( destinationPath ), { recursive: true } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code !== 'EEXIST' ) {
			throw error;
		}
	}

	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	if ( ! response.body ) {
		throw new Error( 'Download response did not include a readable body.' );
	}

	await response.body.pipeTo( Writable.toWeb( fs.createWriteStream( destinationPath ) ) );
}

const partialGithubReleaseSchema = z.object( {
	tag_name: z.string(),
	assets: z.array( z.object( { name: z.string(), browser_download_url: z.string() } ) ),
} );

export async function fetchLatestGithubRelease( repo: string ) {
	const headers: HeadersInit = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'wp-studio-cli',
	};

	// GitHub API has rate limits:
	// - 60 requests/hour for unauthenticated requests
	// - 5,000 requests/hour with token authentication
	// In CI environments, the IP-based rate limit is shared across runners,
	// so we authenticate with GITHUB_TOKEN when available.
	if ( process.env.GITHUB_TOKEN ) {
		headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
	}

	const response = await fetch( `https://api.github.com/repos/${ repo }/releases/latest`, {
		headers,
	} );

	if ( ! response.ok ) {
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	const rawResponse: unknown = await response.json();

	return partialGithubReleaseSchema.parse( rawResponse );
}

type FileMetadata = {
	mtimeMs: number;
	size: number;
};

async function collectDirectoryMetadata(
	directoryPath: string,
	basePath = directoryPath
): Promise< Map< string, FileMetadata > > {
	const files = new Map< string, FileMetadata >();
	const entries = await fs.promises.readdir( directoryPath, { withFileTypes: true } );

	for ( const entry of entries ) {
		const fullPath = path.join( directoryPath, entry.name );

		if ( entry.isDirectory() ) {
			const nestedFiles = await collectDirectoryMetadata( fullPath, basePath );
			for ( const [ key, value ] of nestedFiles ) {
				files.set( key, value );
			}
			continue;
		}

		if ( ! entry.isFile() ) {
			continue;
		}

		const relativePath = path.relative( basePath, fullPath );
		const stats = await fs.promises.lstat( fullPath );
		files.set( relativePath, { size: stats.size, mtimeMs: Math.floor( stats.mtimeMs ) } );
	}

	return files;
}

// Returns true when source and target have any file-level differences by relative path, size, or mtime.
export async function areDirectoriesDifferentBySizeAndMtime(
	sourceDirectoryPath: string,
	targetDirectoryPath: string
): Promise< boolean > {
	if ( ! fs.existsSync( sourceDirectoryPath ) || ! fs.existsSync( targetDirectoryPath ) ) {
		return true;
	}

	const [ sourceFiles, targetFiles ] = await Promise.all( [
		collectDirectoryMetadata( sourceDirectoryPath ),
		collectDirectoryMetadata( targetDirectoryPath ),
	] );

	if ( sourceFiles.size !== targetFiles.size ) {
		return true;
	}

	for ( const [ relativePath, sourceMetadata ] of sourceFiles ) {
		const targetMetadata = targetFiles.get( relativePath );
		if ( ! targetMetadata ) {
			return true;
		}

		if (
			sourceMetadata.size !== targetMetadata.size ||
			sourceMetadata.mtimeMs !== targetMetadata.mtimeMs
		) {
			return true;
		}
	}

	return false;
}
