// src/lib/publish/spacefast.ts
//
// Publish a liberated site to Spacefast (https://spacefast.com) through its
// public HTTP API. The archive lane is one request: POST the site as a zip and
// the receipt comes back complete, so there is no upload/finalize/poll state
// machine to carry here.
//
// Deliberately no SDK or CLI dependency. Spacefast's own publish skill says the
// direct API path is complete, and the CLI is a 36 MB install that a single
// publish does not justify.
//
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createZipArchive, type ZipEntry } from './zip.js';
import { PublishError, type PublishOptions, type PublishResult, type PublishTarget } from './types.js';

const PUBLISH_ENDPOINT = 'https://api.spacefast.com/v1/publish';
/**
 * Preflight ceiling. A liberated site is a bounded set of pages and assets, so
 * far more than this means the wrong directory was passed — publishing it would
 * upload unintended files before anything complains.
 */
const MAX_FILES = 5_000;
const MAX_BYTES = 250 * 1024 * 1024;
/** Client attribution. Never required for a request to succeed. */
const CLIENT = 'data-liberation/publish';

interface SpacefastReceipt {
	data?: {
		space?: { id?: string; liveUrl?: string };
		version?: { immutableUrl?: string; number?: number };
		activation?: { outcome?: string };
		next?: { action?: string; hint?: string };
		claim?: { claimUrl?: string; expiresAt?: string };
		diagnostics?: unknown;
	};
}

interface SpacefastProblem {
	code?: string;
	title?: string;
	detail?: string;
	requestId?: string;
}

/** Collect every file under root as archive entries with POSIX-relative paths. */
export function collectDirectoryEntries( root: string ): ZipEntry[] {
	const entries: ZipEntry[] = [];
	const walk = ( directory: string ): void => {
		for ( const item of readdirSync( directory, { withFileTypes: true } ).sort( ( a, b ) =>
			a.name.localeCompare( b.name )
		) ) {
			const absolute = join( directory, item.name );
			// Resolve through symlinks so a linked asset publishes its bytes.
			if ( item.isDirectory() || ( item.isSymbolicLink() && statSync( absolute ).isDirectory() ) ) {
				walk( absolute );
				continue;
			}
			if ( ! item.isFile() && ! item.isSymbolicLink() ) continue;
			entries.push( {
				path: relative( root, absolute ).split( sep ).join( '/' ),
				contents: readFileSync( absolute ),
			} );
		}
	};
	walk( root );
	return entries;
}

function problemFrom( status: number, body: string ): PublishError {
	let problem: SpacefastProblem = {};
	try {
		problem = JSON.parse( body ) as SpacefastProblem;
	} catch {
		/* not a problem document; fall through to the status-only message */
	}
	// Spacefast returns RFC 9457 problem documents. Branch on the stable `code`.
	const code = problem.code ?? `http_${ status }`;
	const detail = problem.detail ?? problem.title ?? ( body.slice( 0, 200 ) || `HTTP ${ status }` );
	return new PublishError( {
		code,
		message: `Spacefast publish failed (${ code }): ${ detail }`,
		requestId: problem.requestId,
	} );
}

export const spacefastTarget: PublishTarget = {
	name: 'spacefast',

	async publish( options: PublishOptions ): Promise< PublishResult > {
		const log = options.log ?? ( () => {} );
		const entries = collectDirectoryEntries( options.directory );
		if ( entries.length === 0 ) {
			throw new PublishError( {
				code: 'empty_directory',
				message: `Nothing to publish: ${ options.directory } contains no files.`,
			} );
		}

		const bytes = entries.reduce( ( total, entry ) => total + entry.contents.length, 0 );
		if ( entries.length > MAX_FILES || bytes > MAX_BYTES ) {
			throw new PublishError( {
				code: 'directory_too_large',
				message:
					`Refusing to publish ${ options.directory }: ${ entries.length } files, ` +
					`${ Math.round( bytes / 1024 / 1024 ) } MB. That is beyond what a liberated site ` +
					`should be (limit ${ MAX_FILES } files, ${ Math.round( MAX_BYTES / 1024 / 1024 ) } MB). ` +
					'Point publish at a liberated site directory rather than a parent folder.',
			} );
		}

		const archive = createZipArchive( entries );
		log( `[publish] ${ entries.length } files, ${ archive.length } bytes archived` );

		const form = new FormData();
		form.set( 'archive', new Blob( [ new Uint8Array( archive ) ], { type: 'application/zip' } ), 'site.zip' );

		const response = await fetch( PUBLISH_ENDPOINT, {
			method: 'POST',
			body: form,
			headers: {
				'x-spacefast-client': CLIENT,
				...( options.token ? { authorization: `Bearer ${ options.token }` } : {} ),
			},
		} );

		const body = await response.text();
		if ( ! response.ok ) throw problemFrom( response.status, body );

		let receipt: SpacefastReceipt;
		try {
			receipt = JSON.parse( body ) as SpacefastReceipt;
		} catch {
			throw new PublishError( {
				code: 'unreadable_receipt',
				message: 'Spacefast returned a publish receipt that could not be parsed as JSON.',
			} );
		}

		const data = receipt.data;
		const liveUrl = data?.space?.liveUrl;
		if ( ! liveUrl ) {
			throw new PublishError( {
				code: 'receipt_missing_live_url',
				message: 'Spacefast accepted the publish but returned no live URL.',
			} );
		}

		const notes: string[] = [];
		// Liveness is a channel pointer; never infer it from a version status.
		if ( data?.activation?.outcome && data.activation.outcome !== 'activated' ) {
			notes.push( `activation ${ data.activation.outcome }` );
		}
		if ( data?.next?.action && data.next.action !== 'done' ) {
			notes.push( `next step ${ data.next.action }: ${ data.next.hint ?? 'see Spacefast receipt' }` );
		}

		const claimUrl = data?.claim?.claimUrl;
		return {
			target: 'spacefast',
			liveUrl,
			versionUrl: data?.version?.immutableUrl,
			files: entries.length,
			bytes,
			// New spaces are private by default, so a bare live URL 403s until access
			// is granted. Say so rather than let it look like a broken publish.
			private: true,
			...( claimUrl ? { claim: { url: claimUrl, expiresAt: data?.claim?.expiresAt } } : {} ),
			notes,
		};
	},
};
