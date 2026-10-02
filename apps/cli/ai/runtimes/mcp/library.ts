import { existsSync } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { Type } from 'typebox';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { defineTool } from 'cli/ai/tools/define-tool';
import { captureScreenshotBuffer } from 'cli/ai/tools/screenshot-helpers';
import { textResult } from 'cli/ai/tools/utils';
import { getCliAuthenticationUrl, storeAuthToken } from 'cli/commands/auth/login';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getSitesRunningStatus } from 'cli/lib/site-utils';

// The WordPress library: an MCP App the host opens from its sidebar (OpenAI's
// global entrypoint) or a conversation tab, listing the user's local Studio
// sites and WordPress.com sites.

interface LocalSite {
	id: string;
	name: string;
	path: string;
	url?: string;
	running?: boolean;
	phpVersion?: string;
}

// Reads the config directly rather than through site_list, whose console
// capture loses output when the library's calls overlap.
async function readLocalSites(): Promise< LocalSite[] > {
	const { sites } = await readCliConfig();
	const running = await getSitesRunningStatus( sites );
	return sites.map( ( site ) => ( {
		id: site.id,
		name: site.name,
		path: site.path,
		url: getSiteUrl( site ),
		running: running.get( site.id ) ?? false,
		phpVersion: site.phpVersion,
	} ) );
}

async function readWpcomSites() {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		return { signedIn: false, sites: [] };
	}
	try {
		const sites = await fetchSyncableSites( token.accessToken );
		return {
			signedIn: true,
			sites: sites.map( ( site ) => ( {
				id: site.id,
				name: site.name,
				url: site.url,
				planName: site.planName,
				isStaging: site.isStaging,
				syncSupport: site.syncSupport,
				lastPullTimestamp: site.lastPullTimestamp,
				lastPushTimestamp: site.lastPushTimestamp,
				createdAt: site.createdAt,
			} ) ),
		};
	} catch ( error ) {
		return {
			signedIn: true,
			sites: [],
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

async function readLibrary() {
	const [ localSites, wpcom ] = await Promise.all( [ readLocalSites(), readWpcomSites() ] );
	return {
		...textResult(
			`The WordPress library shows ${ localSites.length } local Studio sites${
				wpcom.signedIn ? ` and ${ wpcom.sites.length } WordPress.com sites` : ''
			}.`
		),
		structuredContent: { view: 'library', localSites, wpcom },
	};
}

// The desktop app keeps a screenshot of each site.
function desktopThumbnailPath( siteId: string ): string {
	const appData =
		process.platform === 'darwin'
			? path.join( os.homedir(), 'Library', 'Application Support' )
			: process.platform === 'win32'
			? process.env.APPDATA ?? path.join( os.homedir(), 'AppData', 'Roaming' )
			: process.env.XDG_CONFIG_HOME ?? path.join( os.homedir(), '.config' );
	return path.join( appData, 'Studio', 'thumbnails', `${ siteId }.png` );
}

const PREVIEW_VIEWPORT = { width: 1280, height: 582 };

// A small JPEG of the site's front page: the desktop app's screenshot scaled
// down, or a fresh capture of a running site.
async function previewImage( site: LocalSite ): Promise< string | null > {
	const thumbnail = desktopThumbnailPath( site.id );
	let url: string | undefined;
	let page: string | undefined;
	if ( existsSync( thumbnail ) ) {
		page = path.join( await resolveScreenshotDirectory(), `library-${ site.id }.html` );
		await writeFile(
			page,
			`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}</style><img src="${
				pathToFileURL( thumbnail ).href
			}">`
		);
		url = pathToFileURL( page ).href;
	} else if ( site.running && site.url ) {
		url = site.url;
	}
	if ( ! url ) {
		return null;
	}
	try {
		const capture = await captureScreenshotBuffer( url, PREVIEW_VIEWPORT, {
			fullPage: false,
			format: 'jpeg',
			deviceScaleFactor: 0.5,
		} );
		return `data:image/jpeg;base64,${ capture.buffer.toString( 'base64' ) }`;
	} finally {
		if ( page ) {
			await unlink( page ).catch( () => undefined );
		}
	}
}

export function createLibraryTools() {
	const open = defineTool(
		'open_wordpress',
		"Opens the WordPress library: the user's local Studio sites and WordPress.com sites. The host opens it from its sidebar or a conversation tab; it does not change anything.",
		{},
		readLibrary
	);
	const read = defineTool(
		'read_wordpress_library',
		"Reads the user's local Studio sites and WordPress.com sites for the open WordPress library. Only the library calls it.",
		{},
		readLibrary
	);
	const preview = defineTool(
		'read_site_preview',
		"Returns a small screenshot of a local Studio site's front page for the WordPress library. Only the library calls it.",
		{ siteId: Type.String( { description: 'The local Studio site id.' } ) },
		async ( args ) => {
			const site = ( await readLocalSites() ).find( ( candidate ) => candidate.id === args.siteId );
			const image = site ? await previewImage( site ) : null;
			return {
				...textResult( image ? 'Preview ready.' : 'No preview.' ),
				structuredContent: { image },
			};
		}
	);
	const loginUrl = defineTool(
		'wpcom_login_url',
		'Returns the WordPress.com authorization URL for the WordPress library login. Only the library calls it.',
		{},
		async () => {
			const url = await getCliAuthenticationUrl();
			return { ...textResult( url ), structuredContent: { url } };
		}
	);
	const login = defineTool(
		'wpcom_login',
		'Stores the WordPress.com token the user pasted into the WordPress library. Only the library calls it.',
		{
			token: Type.String( { description: 'The token shown by WordPress.com after authorizing.' } ),
		},
		async ( args ) => {
			const { displayName } = await storeAuthToken( args.token.trim() );
			return {
				...textResult( `Logged in to WordPress.com as ${ displayName }.` ),
				structuredContent: { displayName },
			};
		}
	);
	const appOnly = [ read, preview, loginUrl, login ];
	return { open, appOnly, all: [ open, ...appOnly ] };
}
