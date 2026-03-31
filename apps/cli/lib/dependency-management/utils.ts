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
