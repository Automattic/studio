import { fork, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { cliSiteEventSchema } from '@studio/common/lib/cli-events';
import { Type } from 'typebox';
import BUILT_LIBRARY_HTML from 'virtual:mcp-ui';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { defineTool } from 'cli/ai/tools/define-tool';
import { captureScreenshotBuffer } from 'cli/ai/tools/screenshot-helpers';
import { textResult } from 'cli/ai/tools/utils';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getSitesRunningStatus } from 'cli/lib/site-utils';

// The WordPress library: an MCP App (apps/mcp-ui) listing the user's local
// Studio sites, which OpenAI hosts open from their sidebar or a conversation tab.
// Only the page calls these tools; the model never sees them.

const OPEN_TOOL = 'open_wordpress';
const PREVIEW_TOOL = 'read_site_preview';
const CHANGES_TOOL = 'wait_for_site_changes';

// The sidebar entry's icon: the WordPress logo from @wordpress/icons,
// monochrome in currentColor as the host asks.
const WORDPRESS_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M 22 12 C 22 6.49 17.51 2 12 2 C 6.48 2 2 6.49 2 12 C 2 17.52 6.48 22 12 22 C 17.51 22 22 17.52 22 12 M 9.78 17.37 L 6.37 8.22 C 6.92 8.2 7.54 8.14 7.54 8.14 C 8.04 8.08 7.98 7.01 7.48 7.03 C 7.48 7.03 6.03 7.14 5.11 7.14 C 4.93 7.14 4.74 7.14 4.53 7.13 C 6.12 4.69 8.87 3.11 12 3.11 C 14.33 3.11 16.45 3.98 18.05 5.45 C 17.37 5.34 16.4 5.84 16.4 7.03 C 16.4 7.77 16.85 8.39 17.3 9.13 C 17.65 9.74 17.85 10.49 17.85 11.59 C 17.85 13.08 16.45 16.59 16.45 16.59 L 13.42 8.22 C 13.96 8.2 14.24 8.05 14.24 8.05 C 14.74 8 14.68 6.8 14.18 6.83 C 14.18 6.83 12.74 6.95 11.8 6.95 C 10.93 6.95 9.47 6.83 9.47 6.83 C 8.97 6.8 8.91 8.03 9.41 8.05 L 10.33 8.13 L 11.59 11.54 L 9.78 17.37 M 19.41 12 C 19.65 11.36 20.15 10.13 19.84 7.75 C 20.54 9.04 20.89 10.46 20.89 12 C 20.89 15.29 19.16 18.24 16.49 19.78 C 17.46 17.19 18.43 14.58 19.41 12 M 8.1 20.09 C 5.12 18.65 3.11 15.53 3.11 12 C 3.11 10.7 3.34 9.52 3.83 8.41 C 5.25 12.3 6.67 16.2 8.1 20.09 M 12.13 13.46 L 14.71 20.44 C 13.85 20.73 12.95 20.89 12 20.89 C 11.21 20.89 10.43 20.78 9.71 20.56 C 10.52 18.18 11.33 15.82 12.13 13.46 L 12.13 13.46" /></svg>';

// The plugin's id in the host's marketplace (`<plugin>@<marketplace>`), set by
// the plugin's MCP config: the page's prompts mention it so the host routes them
// here. Run outside a plugin, there is nothing to mention.
const pluginId = process.env.STUDIO_PLUGIN_ID;

export const LIBRARY_APP_HTML = BUILT_LIBRARY_HTML.split( '__STUDIO_PLUGIN_MENTION__' ).join(
	pluginId ? `[@WordPress Studio](plugin://${ pluginId })` : ''
);

// Hosts cache an App's page by its URI, so a changed page needs a new one.
export const LIBRARY_APP_URI = `ui://studio/library-${ createHash( 'sha256' )
	.update( LIBRARY_APP_HTML )
	.digest( 'hex' )
	.slice( 0, 12 ) }.html`;

export const LIBRARY_APP_META = {
	ui: { prefersBorder: true },
	'openai/ui': {
		preferredDisplayMode: 'fullscreen',
		availableDisplayModes: [ 'inline', 'fullscreen' ],
	},
};

const APP_ONLY = { ui: { resourceUri: LIBRARY_APP_URI, visibility: [ 'app' ] } };

// What the tools list adds to a library tool: its page, and for the entry tool
// OpenAI's entrypoints (the sidebar and a conversation tab).
export function libraryListing( toolName: string ): Record< string, unknown > {
	if ( toolName !== OPEN_TOOL ) {
		return toolName === PREVIEW_TOOL || toolName === CHANGES_TOOL ? { _meta: APP_ONLY } : {};
	}
	return {
		title: 'WordPress',
		icons: [
			{
				src: `data:image/svg+xml;base64,${ Buffer.from( WORDPRESS_LOGO_SVG ).toString(
					'base64'
				) }`,
				mimeType: 'image/svg+xml',
				sizes: [ 'any' ],
			},
		],
		_meta: {
			...APP_ONLY,
			'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
		},
	};
}

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

const SITE_CHANGES_WAIT_MS = 50_000;
const SITE_CHANGES_SETTLE_MS = 300;

// Site changes made anywhere (the agent, a terminal, the desktop app) arrive
// through `_events`, as for the desktop app and `studio ui`. The library waits
// on them with wait_for_site_changes: each settled burst bumps `revision`.
function createSiteWatcher() {
	let revision = 0;
	let events: ChildProcess | undefined;
	let settling: NodeJS.Timeout | undefined;
	const waiters = new Set< () => void >();

	const start = () => {
		if ( events ) {
			return;
		}
		events = fork( process.argv[ 1 ], [ '_events', '--listener', 'mcp' ], {
			stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
		} );
		events.on( 'message', ( message ) => {
			if ( ! cliSiteEventSchema.safeParse( message ).success ) {
				return;
			}
			clearTimeout( settling );
			settling = setTimeout( () => {
				revision += 1;
				waiters.forEach( ( wake ) => wake() );
			}, SITE_CHANGES_SETTLE_MS );
		} );
		events.on( 'exit', () => {
			events = undefined;
		} );
	};

	return async ( since?: number ) => {
		start();
		if ( since !== undefined && since === revision ) {
			await new Promise< void >( ( resolve ) => {
				const wake = () => {
					clearTimeout( timer );
					waiters.delete( wake );
					resolve();
				};
				const timer = setTimeout( wake, SITE_CHANGES_WAIT_MS );
				waiters.add( wake );
			} );
		}
		return revision;
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
	const waitForSiteChanges = createSiteWatcher();
	return [
		defineTool(
			OPEN_TOOL,
			"Opens the WordPress library: the user's local Studio sites. The host opens it from its sidebar or a conversation tab, and the library calls it to refresh; it does not change anything.",
			{},
			async () => {
				const localSites = await readLocalSites();
				return {
					...textResult( `The WordPress library shows ${ localSites.length } local Studio sites.` ),
					_meta: { localSites },
				};
			}
		),
		defineTool(
			PREVIEW_TOOL,
			"Returns a small screenshot of a local Studio site's front page for the WordPress library.",
			{ siteId: Type.String( { description: 'The local Studio site id.' } ) },
			async ( args ) => {
				const site = ( await readLocalSites() ).find(
					( candidate ) => candidate.id === args.siteId
				);
				const image = site ? await previewImage( site ) : null;
				return { ...textResult( image ? 'Preview ready.' : 'No preview.' ), _meta: { image } };
			}
		),
		defineTool(
			CHANGES_TOOL,
			'Waits until a local Studio site is created, changed, started, stopped or deleted, then returns the new revision; returns the current revision right away when `since` is missing or out of date.',
			{
				since: Type.Optional(
					Type.Number( { description: 'The revision the library last saw.' } )
				),
			},
			async ( args ) => {
				const revision = await waitForSiteChanges( args.since );
				return { ...textResult( `Revision ${ revision }.` ), _meta: { revision } };
			}
		),
	];
}
