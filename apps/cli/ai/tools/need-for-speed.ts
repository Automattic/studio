import { Type } from 'typebox';
import { auditPerformance } from 'cli/ai/performance-audit';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const auditPerformanceTool = defineTool(
	'need_for_speed',
	'Measures frontend performance metrics for a WordPress site page. Returns Core Web Vitals ' +
		'(TTFB, FCP, LCP, CLS), page weight, DOM size, request count, and a breakdown of JS, CSS, ' +
		'image, and font assets. The site must be running. ' +
		'CALL ONLY ON EXPLICIT USER REQUEST — when the user asks for a performance audit, mentions ' +
		'speed / Core Web Vitals / Lighthouse, or invokes /need-for-speed. Do NOT call this as part of a ' +
		'normal "build a site" or "design a page" workflow.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path — the site must be running',
		} ),
		path: Type.Optional(
			Type.String( {
				description: 'URL path to audit (e.g., "/", "/about", "/wp-admin/"). Defaults to "/".',
			} )
		),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const urlPath = args.path ?? '/';

			emitProgress( `Auditing performance of ${ siteUrl }${ urlPath }…` );

			const result = await auditPerformance( siteUrl, urlPath );

			if ( result.error ) {
				emitProgress( `Audit failed: ${ result.error.slice( 0, 80 ) }` );
				throw new Error( `Performance audit failed: ${ result.error }` );
			}

			emitProgress( `Audit complete for ${ urlPath }` );

			return textResult( JSON.stringify( result, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`Performance audit failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
