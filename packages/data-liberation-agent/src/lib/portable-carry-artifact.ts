import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	assembleCarryTheme,
	type CarryPageInput,
} from '../mcp-server/handlers/reconstruct-pages-carry.js';
import { tag, wxrSource } from './replicate/carry-page-list.js';
import { buildInternalLinkMap } from './streaming/internal-link-rewrite.js';

interface ArtifactFile {
	path: string;
	content?: string;
	content_base64?: string;
	encoding?: string;
	[ key: string ]: unknown;
}

interface WebsiteArtifact {
	schema: string;
	entrypoint: string;
	files: ArtifactFile[];
	provenance?: Record< string, unknown >;
	[ key: string ]: unknown;
}

interface CaptureReceipt {
	routes?: Array< { url?: string; path?: string } >;
}

function fileContent( file: ArtifactFile ): string {
	if ( typeof file.content === 'string' ) return file.content;
	if ( typeof file.content_base64 === 'string' ) {
		return Buffer.from( file.content_base64, 'base64' ).toString( 'utf8' );
	}
	return '';
}

function normalizedUrl( value: string ): string {
	const url = new URL( value );
	url.hash = '';
	url.pathname = url.pathname.replace( /\/$/, '' ) || '/';
	return url.href;
}

function routeSlug( url: string, entrypoint: boolean ): string {
	if ( entrypoint ) return 'home';
	const segments = new URL( url ).pathname.split( '/' ).filter( Boolean );
	return ( segments.at( -1 ) ?? 'page' )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-|-$/g, '' );
}

function documentTitle( html: string, fallback: string ): string {
	const match = /<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)\s*>/i.exec( html );
	return (
		match?.[ 1 ]
			.replace( /<[^>]+>/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim() || fallback
	);
}

function wxrRouteMetadata(
	outputDir: string
): Map< string, { slug: string; title: string; postType: 'page' | 'post' } > {
	const metadata = new Map< string, { slug: string; title: string; postType: 'page' | 'post' } >();
	const wxr = readFileSync( wxrSource( outputDir ), 'utf8' );
	for ( const item of wxr.split( '<item>' ).slice( 1 ) ) {
		const block = item.split( '</item>' )[ 0 ];
		const link = tag( block, 'link' );
		const slug = tag( block, 'wp:post_name' );
		const postType = tag( block, 'wp:post_type' );
		if ( ! link || ! slug || postType === 'attachment' || postType === 'nav_menu_item' ) continue;
		metadata.set( normalizedUrl( link ), {
			slug,
			title: tag( block, 'title' ) || slug,
			postType: postType === 'page' ? 'page' : 'post',
		} );
	}
	return metadata;
}

function portableCss( css: string ): string {
	return css.replace( /body\.lib-carry-site/g, '.lib-carry-site' );
}

function escapeHtml( value: string ): string {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function htmlDocument( title: string, bodyHtml: string, stylesheets: string[] ): string {
	const links = stylesheets
		.map( ( href ) => `<link rel="stylesheet" href="/${ href.replace( /^website\//, '' ) }">` )
		.join( '\n' );
	return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ escapeHtml(
		title
	) }</title>\n${ links }</head><body>\n${ bodyHtml }\n</body></html>`;
}

/** Replace raw browser-capture documents with deterministic carry reconstruction. */
export function projectPortableCarryArtifact( outputDir: string, artifactPath: string ): void {
	const artifact = JSON.parse( readFileSync( artifactPath, 'utf8' ) ) as WebsiteArtifact;
	const receipt = JSON.parse(
		readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' )
	) as CaptureReceipt;
	const filesByPath = new Map( artifact.files.map( ( file ) => [ file.path, file ] ) );

	const routeMetadata = wxrRouteMetadata( outputDir );
	const sourceCss = artifact.files
		.filter( ( file ) => file.path.toLowerCase().endsWith( '.css' ) )
		.map( fileContent )
		.join( '\n' );
	const capturedRoutes = ( receipt.routes ?? [] ).flatMap( ( route ) => {
		if ( ! route.url || ! route.path ) return [];
		const routeFile = filesByPath.get( route.path );
		if ( ! routeFile ) {
			throw new Error( `Carry reconstruction is missing captured route: ${ route.url }` );
		}
		const metadata = routeMetadata.get( normalizedUrl( route.url ) );
		const isHome = route.path === artifact.entrypoint;
		const slug = metadata?.slug || routeSlug( route.url, isHome );
		return [
			{
				url: route.url,
				path: route.path,
				page: {
					slug,
					title: metadata?.title || documentTitle( fileContent( routeFile ), slug ),
					isHome,
					postType: metadata?.postType ?? 'page',
					bodyHtml: fileContent( routeFile ),
					css: sourceCss,
				} satisfies CarryPageInput,
			},
		];
	} );
	const pages = capturedRoutes.map( ( route ) => route.page );
	if ( pages.length === 0 ) throw new Error( 'Carry reconstruction produced no portable pages.' );

	const assembled = assembleCarryTheme( {
		themeName: 'Liberated (Carry)',
		pages,
		mediaUrlMap: new Map(),
		linkMap: buildInternalLinkMap(
			capturedRoutes.map( ( route ) => ( {
				from: new URL( route.url ).pathname,
				to: `/${ route.path.replace( /^website\//, '' ) }`,
			} ) ),
			{ siteOrigins: capturedRoutes.map( ( route ) => new URL( route.url ).hostname ) }
		),
	} );
	if ( assembled.skipped.length > 0 || assembled.portablePages.length !== pages.length ) {
		throw new Error( `Carry reconstruction skipped routes: ${ assembled.skipped.join( ', ' ) }` );
	}

	const carryStyles = assembled.themeFiles
		.filter( ( file ) => file.path.startsWith( 'assets/css/' ) && file.path.endsWith( '.css' ) )
		.map( ( file ) => ( {
			path: `website/${ file.path }`,
			content: portableCss( file.content ),
			encoding: 'utf8',
			kind: 'css',
			role: 'visual-repair',
		} ) );
	const stylesheetPaths = carryStyles.map( ( file ) => file.path );
	const reconstructedByPath = new Map< string, ArtifactFile >();
	for ( const [ index, page ] of assembled.portablePages.entries() ) {
		const route = capturedRoutes[ index ];
		reconstructedByPath.set( route.path, {
			path: route.path,
			content: htmlDocument( page.title, page.bodyHtml, stylesheetPaths ),
			encoding: 'utf8',
			kind: 'html',
			role: route.path === artifact.entrypoint ? 'entrypoint' : 'page',
			source_url: route.url,
			post_type: page.postType ?? 'page',
		} );
	}

	const routePaths = new Set(
		( receipt.routes ?? [] ).flatMap( ( route ) => ( route.path ? [ route.path ] : [] ) )
	);
	artifact.files = [
		...artifact.files.filter(
			( file ) => ! routePaths.has( file.path ) && ! file.path.toLowerCase().endsWith( '.css' )
		),
		...reconstructedByPath.values(),
		...carryStyles,
	];
	artifact.theme_materialization = 'classic';
	artifact.provenance = {
		...( artifact.provenance ?? {} ),
		provider: 'data-liberation/carry-reconstruction',
	};
	const tempPath = `${ artifactPath }.tmp`;
	writeFileSync( tempPath, `${ JSON.stringify( artifact ) }\n` );
	renameSync( tempPath, artifactPath );
}
