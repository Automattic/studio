import { Type } from 'typebox';
import { auditSeo } from 'cli/ai/seo-audit';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const auditSeoTool = defineTool(
	'rank_me_up',
	'Runs an on-page SEO audit on a WordPress site page. Returns title and meta description, ' +
		'canonical/robots/viewport tags, Open Graph and Twitter cards, heading structure, image alt-text ' +
		'coverage, internal/external link counts, JSON-LD structured data, and robots.txt/sitemap.xml ' +
		'availability. The site must be running. ' +
		'CALL ONLY ON EXPLICIT USER REQUEST — when the user asks for an SEO audit, mentions ' +
		'meta tags / OpenGraph / sitemap / search visibility, or invokes /rank-me-up. Do NOT call this as ' +
		'part of a normal "build a site" or "design a page" workflow.',
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
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const urlPath = args.path ?? '/';

			emitProgress( `Auditing SEO of ${ siteUrl }${ urlPath }…` );

			const result = await auditSeo( siteUrl, urlPath );

			if ( result.error ) {
				emitProgress( `Audit failed: ${ result.error.slice( 0, 80 ) }` );
				throw new Error( `SEO audit failed: ${ result.error }` );
			}

			emitProgress( `SEO audit complete for ${ urlPath }` );

			return textResult( JSON.stringify( result, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`SEO audit failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
