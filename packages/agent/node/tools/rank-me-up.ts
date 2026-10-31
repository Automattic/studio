import { Type } from 'typebox';
import { auditSeo } from '@studio/agent/node/seo-audit';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const auditSeoTool = defineTool(
	'rank_me_up',
	'Runs an on-page SEO audit on a WordPress site page. Returns title and meta description, ' +
		'canonical/robots/viewport tags, Open Graph and Twitter cards, heading structure, image alt-text ' +
		'coverage, internal/external link counts, JSON-LD structured data, and robots.txt/sitemap.xml ' +
		'availability. The site must be running.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path — the site must be running',
		} ),
		path: Type.Optional(
			Type.String( {
				description: 'URL path to audit (e.g., "/", "/about"). Defaults to "/".',
			} )
		),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const siteUrl = site.url;
			const urlPath = args.path ?? '/';

			context.onProgress( `Auditing SEO of ${ siteUrl }${ urlPath }…` );

			const result = await auditSeo( siteUrl, urlPath );

			if ( result.error ) {
				context.onProgress( `Audit failed: ${ result.error.slice( 0, 80 ) }` );
				throw new Error( `SEO audit failed: ${ result.error }` );
			}

			context.onProgress( `SEO audit complete for ${ urlPath }` );

			return textResult( JSON.stringify( result, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`SEO audit failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		annotations: READ_ONLY,
	}
);
