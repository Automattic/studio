/**
 * Spacefast serves static files. What Studio publishes there is a static copy
 * of the local site: Data Liberation captures every page the running site
 * serves, checks the copy against the site, and publishes the copy to a
 * Spacefast space. The space is remembered per local site, so publishing
 * again replaces that space's content.
 *
 * Without SPACEFAST_TOKEN the space is anonymous: its claim link moves it into
 * the user's account, and its claim key is what publishes to it again.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { Logger } from 'cli/logger';
import type { HostSite, ProgressCallback, RemoteHost } from '@studio/agent/node';

interface PublishedSpace {
	id: string;
	liveUrl: string;
	publishedAt: string;
	claim?: { url: string; key?: string; expiresAt?: string };
}

/** The `id` of the space a local site has not been published to yet. */
const NEW_SPACE = 'new';

function recordPath(): string {
	return path.join( getConfigDirectory(), 'spacefast-spaces.json' );
}

function readSpaces(): Record< string, PublishedSpace > {
	try {
		return JSON.parse( fs.readFileSync( recordPath(), 'utf8' ) );
	} catch {
		return {};
	}
}

function spaceOf( sitePath: string ): PublishedSpace | undefined {
	return readSpaces()[ path.resolve( sitePath ) ];
}

// The record holds claim keys, which publish to their space, so only the user reads it.
function saveSpace( sitePath: string, space: PublishedSpace ): void {
	const spaces = { ...readSpaces(), [ path.resolve( sitePath ) ]: space };
	fs.mkdirSync( path.dirname( recordPath() ), { recursive: true } );
	fs.writeFileSync( recordPath(), JSON.stringify( spaces, null, '\t' ), { mode: 0o600 } );
}

function listed( space: PublishedSpace | undefined ) {
	return space
		? { id: space.id, name: new URL( space.liveUrl ).hostname, url: space.liveUrl }
		: { id: NEW_SPACE, name: 'A new Spacefast space', url: 'https://space.fast' };
}

async function push(
	site: HostSite,
	target: string,
	onProgress: ProgressCallback
): Promise< string > {
	const [ { runCommand: startSite }, { captureLocalSite } ] = await Promise.all( [
		import( 'cli/commands/site/start' ),
		import( 'cli/lib/data-liberation-client' ),
	] );
	const sitePath = site.path;
	const known = spaceOf( sitePath );
	if ( target !== NEW_SPACE && target !== known?.id && target !== known?.liveUrl ) {
		throw new Error(
			`This site was not published to ${ target }. Publish it to "${
				known?.id ?? NEW_SPACE
			}" instead.`
		);
	}
	const space = target === NEW_SPACE ? undefined : known;

	await startSite( sitePath, true, true, new Logger( { onProgress } ) );
	const siteUrl = site.url;
	const outputBase = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-spacefast-' ) );
	try {
		const copy = await captureLocalSite( siteUrl, outputBase, ( message ) =>
			onProgress( message )
		);
		const token = process.env.SPACEFAST_TOKEN || space?.claim?.key;
		const published = await copy.publish( { target: 'spacefast', token, space: space?.id } );
		const claim = published.claim ?? space?.claim;
		saveSpace( sitePath, {
			// A target that does not name its space gets a new one each time.
			id: published.spaceId ?? space?.id ?? NEW_SPACE,
			liveUrl: published.liveUrl,
			publishedAt: new Date().toISOString(),
			...( claim ? { claim } : {} ),
		} );
		// The receipt is the push's output, for the agent and for /publish.
		return [
			`Published a static copy of ${ siteUrl } to ${ published.liveUrl }`,
			...( published.private
				? [
						claim
							? `The space is private until it is claimed: ${ claim.url }`
							: 'The space is private until access is granted.',
				  ]
				: [] ),
			...published.notes,
		].join( '\n' );
	} finally {
		fs.rmSync( outputBase, { recursive: true, force: true } );
	}
}

export const spacefast: RemoteHost = {
	name: 'Spacefast',
	environment:
		'A Spacefast space holds a static copy of a local site: its pages, styles and media as files, with no WordPress behind them.',
	publishes:
		'static copies of a local site, as Spacefast spaces: every page, style and media file, with no WordPress behind them, so forms, comments, search and logins do not work there',
	signIn:
		"Spacefast publishes without signing in: the first publish returns a link that claims the space into the user's account. With SPACEFAST_TOKEN set, it publishes into that account.",
	async publishable( sitePath ) {
		return { signedIn: true, sites: [ listed( spaceOf( sitePath ) ) ] };
	},
	newSiteUrl: () => 'https://spacefast.com',
	async targets( site ) {
		const space = spaceOf( site.path );
		return {
			signedIn: true,
			targets: [
				{
					...listed( space ),
					...( space ? { lastPushTimestamp: space.publishedAt } : {} ),
					...( space?.claim ? { claim: space.claim.url } : {} ),
				},
			],
		};
	},
	async mcpServer() {
		return undefined;
	},
	push: ( site, target, _options, onProgress ) => push( site, target, onProgress ),
};
