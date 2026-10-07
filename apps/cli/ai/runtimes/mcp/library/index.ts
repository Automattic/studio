import { Type } from 'typebox';
import { defineTool } from 'cli/ai/tools/define-tool';
import { textResult } from 'cli/ai/tools/utils';
import { createSiteWatcher } from './site-changes';
import { capturePreview, readLocalSites } from './sites';

export { type AppPage, libraryPage } from './page';

// The WordPress library: an MCP App (apps/mcp-ui) listing the local Studio
// sites, which OpenAI hosts open from their sidebar. Only the page calls its
// tools; the model never sees them.

// The WordPress logo from @wordpress/icons, for the sidebar entry.
const WORDPRESS_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M 22 12 C 22 6.49 17.51 2 12 2 C 6.48 2 2 6.49 2 12 C 2 17.52 6.48 22 12 22 C 17.51 22 22 17.52 22 12 M 9.78 17.37 L 6.37 8.22 C 6.92 8.2 7.54 8.14 7.54 8.14 C 8.04 8.08 7.98 7.01 7.48 7.03 C 7.48 7.03 6.03 7.14 5.11 7.14 C 4.93 7.14 4.74 7.14 4.53 7.13 C 6.12 4.69 8.87 3.11 12 3.11 C 14.33 3.11 16.45 3.98 18.05 5.45 C 17.37 5.34 16.4 5.84 16.4 7.03 C 16.4 7.77 16.85 8.39 17.3 9.13 C 17.65 9.74 17.85 10.49 17.85 11.59 C 17.85 13.08 16.45 16.59 16.45 16.59 L 13.42 8.22 C 13.96 8.2 14.24 8.05 14.24 8.05 C 14.74 8 14.68 6.8 14.18 6.83 C 14.18 6.83 12.74 6.95 11.8 6.95 C 10.93 6.95 9.47 6.83 9.47 6.83 C 8.97 6.8 8.91 8.03 9.41 8.05 L 10.33 8.13 L 11.59 11.54 L 9.78 17.37 M 19.41 12 C 19.65 11.36 20.15 10.13 19.84 7.75 C 20.54 9.04 20.89 10.46 20.89 12 C 20.89 15.29 19.16 18.24 16.49 19.78 C 17.46 17.19 18.43 14.58 19.41 12 M 8.1 20.09 C 5.12 18.65 3.11 15.53 3.11 12 C 3.11 10.7 3.34 9.52 3.83 8.41 C 5.25 12.3 6.67 16.2 8.1 20.09 M 12.13 13.46 L 14.71 20.44 C 13.85 20.73 12.95 20.89 12 20.89 C 11.21 20.89 10.43 20.78 9.71 20.56 C 10.52 18.18 11.33 15.82 12.13 13.46 L 12.13 13.46" /></svg>';

// The library's tools, each with what the tools list adds: the page, which alone
// calls them, and for `open_wordpress` the sidebar entry.
export function createLibraryTools( uri: string ) {
	const pageOnly = { ui: { resourceUri: uri, visibility: [ 'app' ] } };
	const waitForSiteChanges = createSiteWatcher();
	return [
		{
			tool: defineTool( 'open_wordpress', "Opens the user's local Studio sites.", {}, async () => {
				const localSites = await readLocalSites();
				return { ...textResult( `${ localSites.length } local sites.` ), _meta: { localSites } };
			} ),
			listing: {
				title: 'WordPress',
				icons: [
					{
						src: `data:image/svg+xml;base64,${ Buffer.from( WORDPRESS_LOGO_SVG ).toString(
							'base64'
						) }`,
						mimeType: 'image/svg+xml',
					},
				],
				_meta: {
					...pageOnly,
					'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
				},
			},
		},
		{
			tool: defineTool(
				'read_site_preview',
				"Captures a running site's front page.",
				{ siteId: Type.String() },
				async ( { siteId } ) => {
					const site = ( await readLocalSites() ).find( ( candidate ) => candidate.id === siteId );
					if ( ! site?.running ) {
						return { ...textResult( 'No preview.' ), _meta: { image: null } };
					}
					return {
						...textResult( 'Preview ready.' ),
						_meta: { image: await capturePreview( site.url ) },
					};
				}
			),
			listing: { _meta: pageOnly },
		},
		{
			tool: defineTool(
				'wait_for_site_changes',
				'Returns the site revision once it moves past `since`, or within a minute.',
				{ since: Type.Optional( Type.Number() ) },
				async ( { since } ) => {
					const revision = await waitForSiteChanges( since );
					return { ...textResult( `Revision ${ revision }.` ), _meta: { revision } };
				}
			),
			listing: { _meta: pageOnly },
		},
	];
}
