import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// An MCP App page, as `studio mcp` serves it.
export interface AppPage {
	uri: string;
	name: string;
	text: string;
	_meta?: Record< string, unknown >;
}

let page: AppPage | null | undefined;

// The page, which the CLI build copies next to its chunks once built (`npm run
// cli:build:mcp-ui`). Its prompts mention the plugin (STUDIO_PLUGIN_ID, set by
// the plugin's MCP config) so the host routes them here.
export function libraryPage(): AppPage | null {
	if ( page === undefined ) {
		try {
			const pluginId = process.env.STUDIO_PLUGIN_ID;
			const text = readFileSync(
				path.resolve( import.meta.dirname, 'mcp-ui', 'index.html' ),
				'utf8'
			)
				.split( '__STUDIO_PLUGIN_MENTION__' )
				.join( pluginId ? `[@WordPress Studio](plugin://${ pluginId })` : '' );
			// Hosts cache a page by its URI, so a changed page needs a new one.
			const hash = createHash( 'sha256' ).update( text ).digest( 'hex' ).slice( 0, 12 );
			page = {
				uri: `ui://studio/library-${ hash }.html`,
				name: 'WordPress',
				text,
				_meta: {
					ui: { prefersBorder: true },
					'openai/ui': { preferredDisplayMode: 'fullscreen' },
				},
			};
		} catch {
			page = null;
		}
	}
	return page;
}
