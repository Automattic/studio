import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtmlAttr } from './html-escape.js';
import { appendScrollDrivenAnimations } from './scroll-driven-animations.js';
import { scopeCss } from './replicate/css-scope.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';
import {
	buildLayoutGeometryProof,
	type GeometryCapture,
} from './screenshot/layout-geometry-proof.js';
import {
	failuresAreAbsentDocument,
	isAbsentDocumentRender,
	isSourceCaptureUrl,
} from './screenshot/absent-document.js';
import { isInlineUrl, selfContainWebsite } from './self-contain.js';
import { wireCapturedDialogs } from './static-dialogs.js';
import { rewriteMediaUrls } from './streaming/media-url-rewrite.js';
import {
	INTERACTION_STATES_SCHEMA,
	LEGACY_INTERACTION_STATES_SCHEMA,
	type InteractionStatesReport,
} from './screenshot/interaction-capture.js';
import { SCROLL_STATES_SCHEMA, type ScrollStatesReport } from './screenshot/scroll-state-capture.js';
import { isAudioLink, type CapturedResourceManifest } from './screenshot/resource-capture.js';
import { isSourcePromotion } from './source-cleanup.js';

export const CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';
export const SOURCE_PROFILE_SCHEMA = 'data-liberation/source-profile/v1';
export const ASSET_EVIDENCE_SCHEMA = 'data-liberation/asset-evidence/v1';
const MAX_ASSET_EVIDENCE_ASSETS = 10_000;
const MAX_ASSET_EVIDENCE_REFERENCES = 100;
const MAX_ASSET_EVIDENCE_CSS_RESOURCES_PER_ROUTE = 10_000;

type ManifestEntryFluid =
	| {
			applied: number;
			unmodelled: number;
			breakpoints: number[];
			canvasFloor?: number | null;
			byKind: Record< string, number >;
	  }
	| undefined;
export const CAPTURED_INTERACTIONS_SCHEMA = 'data-liberation/captured-interactions/v1';
export const CAPTURED_SCROLL_STATES_SCHEMA = 'data-liberation/captured-scroll-states/v1';
/** Indexed semantic evidence sidecar schema. */
export const INDEXED_SEMANTIC_EVIDENCE_SCHEMA = 'data-liberation/captured-semantic-evidence/v2';
const MAX_SEMANTIC_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;

type SemanticEvidencePage = {
	path: string;
	url: string;
	viewports: Record< string, Record< string, unknown >[] >;
};

interface SemanticEvidenceArtifacts {
	index: { path: string; content: string };
	shards: Array< { path: string; content: string; pageCount: number }>;
}

function semanticEvidenceArtifacts( pages: SemanticEvidencePage[] ): SemanticEvidenceArtifacts {
	const shards: SemanticEvidenceArtifacts[ 'shards' ] = [];
	let shardPages: SemanticEvidencePage[] = [];
	const shardContent = ( candidates: SemanticEvidencePage[] ) =>
		`${ JSON.stringify( { schema: INDEXED_SEMANTIC_EVIDENCE_SCHEMA, pages: candidates } ) }\n`;
	for ( const page of pages ) {
		const single = shardContent( [ page ] );
		if ( Buffer.byteLength( single ) > MAX_SEMANTIC_EVIDENCE_FILE_BYTES )
			throw new Error(
				`Semantic evidence page "${ page.path }" exceeds sidecar file limit: ${ Buffer.byteLength( single ) } bytes.`
			);
		const candidate = shardContent( [ ...shardPages, page ] );
		if ( shardPages.length > 0 && Buffer.byteLength( candidate ) > MAX_SEMANTIC_EVIDENCE_FILE_BYTES ) {
			shards.push( {
				path: `semantic-evidence/shard-${ String( shards.length + 1 ).padStart( 4, '0' ) }.json`,
				content: shardContent( shardPages ),
				pageCount: shardPages.length,
			} );
			shardPages = [ page ];
		} else shardPages.push( page );
	}
	if ( shardPages.length > 0 )
		shards.push( {
			path: `semantic-evidence/shard-${ String( shards.length + 1 ).padStart( 4, '0' ) }.json`,
			content: shardContent( shardPages ),
			pageCount: shardPages.length,
		} );
	const index = {
		path: 'semantic-evidence.index.json',
		content: `${ JSON.stringify( {
			schema: INDEXED_SEMANTIC_EVIDENCE_SCHEMA,
			page_count: pages.length,
			shards: shards.map( ( shard ) => ( { path: shard.path, page_count: shard.pageCount } ) ),
		} ) }\n`,
	};
	if ( Buffer.byteLength( index.content ) > MAX_SEMANTIC_EVIDENCE_FILE_BYTES )
		throw new Error( `Semantic evidence index exceeds sidecar file limit: ${ Buffer.byteLength( index.content ) } bytes.` );
	return { index, shards };
}

function withoutGeometryIdentities( html: string ): string {
	return html.replace( /\sdata-dla-geometry-id=(?:"[^"]*"|'[^']*')/g, '' );
}

interface CaptureManifestEntry {
	cleanup?: import('./screenshot/manifest-queue.js').ManifestEntry['cleanup'];
	slug?: string;
	html?: string;
	sections?: string;
	interactions?: InteractionStatesReport;
	scrollStates?: ScrollStatesReport;
	/** Responsive learning outcome recorded during capture. */
	fluid?: ManifestEntryFluid;
	metadata?: {
		openGraph?: Record< string, string >;
	};
}

interface ScreenshotManifest {
	version: 1;
	entries: Record< string, CaptureManifestEntry >;
}

interface ExportCaptureOptions {
	outputDir: string;
	sourceUrl: string;
	platform: string;
	title?: string;
	summary: Record< string, unknown >;
	failures: Array< { url: unknown; error: unknown } >;
	discoveryDiagnostics?: Array< { code: string; url: string; reason: string } >;
	/** Overrides the portable media byte budget. */
	limits?: { portableMediaTotalBytes?: number };
}

interface PortableDependency {
	reference: string;
	url: string;
	kind: 'resource' | 'media' | 'css';
}

interface AssetEvidenceReference {
	route: string;
	path: string;
	document: 'desktop' | 'mobile' | 'css';
	reference: string;
}

interface AssetEvidenceRecord {
	id: string;
	sourceUrl: string;
	outcome: 'successful' | 'failed' | 'unknown';
	retrieval: 'retrieved' | 'failed' | 'unknown';
	portable: 'included' | 'excluded' | 'not-included';
	path?: string;
	portableAssetId?: string;
	error?: string;
	referenceCount: number;
	referencesTruncated: boolean;
	references: AssetEvidenceReference[];
}

interface MediaCandidate {
	sourceUrl: string;
	localPath: string;
	references: string[];
	exactReferences: string[];
	bytes: number;
	dimension: number;
}

interface CaptureEntry {
	slug: string;
	url: string;
	htmlPath: string;
	evidenceDocuments: Array< { state: 'desktop' | 'mobile'; html: string } >;
	/** The source served a structurally distinct document under mobile emulation. */
	hasMobileDocument?: boolean;
	/** Receipt evidence for how many responsive variants this route ships and why. */
	responsiveVariants?: ResponsiveVariantEvidence;
	identityHtmlPath?: string;
	sections?: string;
	canonicalUrl?: string;
	jsonLd: string[];
	interactions?: InteractionStatesReport;
	scrollStates?: ScrollStatesReport;
	styleHoistContext: StyleHoistContext;
}

function isUsableSectionEvidence( sections: unknown ): sections is Record< string, unknown >[] {
	return (
		Array.isArray( sections ) &&
		sections.length > 0 &&
		sections.every(
			( section ) =>
				section !== null &&
				typeof section === 'object' &&
				typeof ( section as Record< string, unknown > ).selector === 'string' &&
				( section as Record< string, unknown > ).selector !== ''
		)
	);
}

function semanticSectionEvidence(
	sections: Record< string, unknown >[]
): Record< string, unknown >[] {
	return sections.map( ( section ) => {
		// These snapshots are reconstruction inputs already represented by the
		// captured page HTML, not semantic evidence. Each may be up to 600 KB.
		const evidence = { ...section };
		delete evidence.sectionHtml;
		delete evidence.styledHtml;
		return evidence;
	} );
}

function fileHash( path: string ): string {
	return createHash( 'sha256' ).update( readFileSync( path ) ).digest( 'hex' );
}

function uniqueAssetPath(
	requestedPath: string,
	contentHash: string,
	hashesByPath: Map< string, string >
): string {
	const existingHash = hashesByPath.get( requestedPath );
	if ( existingHash === undefined || existingHash === contentHash ) return requestedPath;
	const extension = extname( requestedPath );
	return `${ requestedPath.slice(
		0,
		requestedPath.length - extension.length
	) }-${ contentHash.slice( 0, 12 ) }${ extension }`;
}

const MAX_PORTABLE_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_PORTABLE_RESPONSIVE_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_PORTABLE_MEDIA_DIMENSION = 2048;
const MAX_PORTABLE_MEDIA_TOTAL_BYTES = 160 * 1024 * 1024;
const STYLE_HOIST_DIAGNOSTIC_SAMPLE_BYTES = 31 * 1024;
const TRANSPARENT_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const MAX_DECLARATIVE_FORM_EMBEDS = 32;
const MAX_JSON_LD_SCRIPTS = 16;
const MAX_JSON_LD_SCRIPT_BYTES = 64 * 1024;
const MAX_JSON_LD_TOTAL_BYTES = 256 * 1024;
const VISUAL_IFRAME_EVIDENCE_ATTRIBUTES = {
	src: 'data-dla-visual-iframe-src',
	width: 'data-dla-visual-iframe-width',
	height: 'data-dla-visual-iframe-height',
};
const VISUAL_IFRAME_ATTRIBUTES = new Set( [
	'allow',
	'allowfullscreen',
	'class',
	'height',
	'loading',
	'referrerpolicy',
	'sandbox',
	'src',
	'title',
	'width',
] );
const HUBSPOT_FORM_HOSTS = new Map( [
	[ 'na1', 'js.hsforms.net' ],
	[ 'eu1', 'js-eu1.hsforms.net' ],
] );

function pathWithin( root: string, candidate: string ): boolean {
	const rel = relative( resolve( root ), resolve( candidate ) );
	return rel === '' || ( ! rel.startsWith( `..${ sep }` ) && rel !== '..' );
}

function normalizedUrl( url: string ): string {
	const parsed = new URL( url );
	parsed.hash = '';
	parsed.search = '';
	parsed.pathname = parsed.pathname.replace( /\/$/, '' ) || '/';
	return parsed.href;
}

function isOriginRootPath( pathname: string ): boolean {
	return ( pathname.replace( /\/$/, '' ) || '/' ) === '/';
}

function capturedOriginRoot( urls: string[], origin: string ): boolean {
	return urls.some( ( url ) => {
		try {
			const route = new URL( url );
			return route.origin === origin && isOriginRootPath( route.pathname );
		} catch {
			return false;
		}
	} );
}

function routeOutputPath(
	url: string,
	sourceUrl: string,
	entrypointUrl: string,
	originRootCaptured: boolean
): string {
	if ( url === entrypointUrl && ! originRootCaptured ) return 'index.html';
	const route = new URL( url );
	const source = new URL( sourceUrl );
	// Artifact paths must retain URL percent-encoding. Decoding turns a valid
	// route such as `%26` into a different filesystem path and breaks route maps.
	let pathname = route.pathname;
	for ( const segment of pathname.split( '/' ) ) {
		let decoded = segment;
		try {
			decoded = decodeURIComponent( segment );
		} catch {
			// Preserve malformed percent escapes as opaque path bytes.
		}
		if ( decoded === '.' || decoded === '..' || /[\\/\0]/.test( decoded ) )
			throw new Error( `Captured route path escapes the website directory: ${ route.pathname }` );
	}
	const sourcePath = originRootCaptured ? '' : source.pathname.replace( /\/$/, '' );

	if ( route.origin === source.origin && sourcePath && pathname.startsWith( `${ sourcePath }/` ) ) {
		pathname = pathname.slice( sourcePath.length );
	} else if ( route.origin === source.origin && sourcePath && pathname.replace( /\/$/, '' ) === sourcePath ) {
		pathname = '/';
	}

	const cleanPath = pathname.replace( /^\/+|\/+$/g, '' );
	if ( ! cleanPath ) return 'index.html';
	if ( /\.[a-z0-9]+$/i.test( cleanPath ) ) return cleanPath;
	return join( cleanPath, 'index.html' );
}

/**
 * Reports whether a captured page is an alternate address for an already claimed route.
 *
 * Sites commonly serve one document from several URLs, such as `/` and `/index.html`.
 * The alternate address declares the claimed route as its canonical URL, so the capture
 * keeps the claimed page and links the alternate address to it.
 */
function declaresCanonicalRoute( entry: CaptureEntry, claimed: CaptureEntry ): boolean {
	if ( ! entry.canonicalUrl ) return false;
	const claimedCanonical = claimed.canonicalUrl
		? normalizedUrl( claimed.canonicalUrl )
		: normalizedUrl( claimed.url );
	return normalizedUrl( entry.canonicalUrl ) === claimedCanonical;
}

/**
 * Where a copied document lives in the artifact, and every path the artifact serves.
 *
 * Captured documents move: a site captured at a subpath serves `/docs/intro` from
 * `/intro/index.html`, so a relative href keeps its spelling but loses its meaning.
 * Given this, links that don't land on something the artifact serves are resolved
 * against the source document instead of being left to dangle.
 */
interface PortableLinkContext {
	documentPath: string;
	servedPaths: Set< string >;
}

const PORTABLE_LINK_BASE = 'https://portable.invalid';

function rewriteCapturedRouteLinks(
	html: string,
	documentUrl: string,
	routes: Map< string, string >,
	portable?: PortableLinkContext
): string {
	const $ = cheerio.load( html );
	// `rel="canonical"` naming a URL this capture actually produced is source
	// provenance, not an SEO signal the copy should keep declaring — a reader
	// (or a search engine) following it lands back on the source.
	$( 'a[href],area[href],link[rel="canonical"][href]' ).each( ( _index, element ) => {
		const link = $( element );
		const href = link.attr( 'href' ) ?? '';
		const absolute = /^(?:https?:)?\/\//i.test( href );
		// Same-document fragments, and schemes such as `mailto:` or `tel:`, mean
		// the same thing wherever the document is served.
		if ( ! absolute && ( ! href.trim() || /^\s*(?:#|[a-z][a-z0-9+.-]*:)/i.test( href ) ) ) return;

		let resolved: URL;
		try {
			resolved = new URL( href, documentUrl );
		} catch {
			return;
		}
		const route = routes.get( normalizedUrl( resolved.href ) );
		if ( route ) {
			link.attr( 'href', `${ route }${ resolved.search }${ resolved.hash }` );
			return;
		}
		if ( absolute || ! portable ) return;
		// Paths the export itself wrote (routes, localized media and resources)
		// already resolve in the copy.
		try {
			const local = new URL( href, `${ PORTABLE_LINK_BASE }${ portable.documentPath }` );
			if ( portable.servedPaths.has( local.pathname ) ) return;
		} catch {
			return;
		}
		// A relative link to something that was not captured would dangle once
		// the document moves, so point it at the source it was written against.
		if ( /^https?:$/.test( resolved.protocol ) ) link.attr( 'href', resolved.href );
	} );
	return $.html();
}

// Substring replacement is only safe for distinct URL-ish tokens (absolute URLs,
// `/media/logo.png`, `images/logo.png`). A single character or punctuation-only
// string (`/`, `//`, `./`) is ordinary HTML/CSS syntax — closing tags, protocol
// separators, relative prefixes — not a specific reference.
function isSubstitutableReplacementKey( source: string ): boolean {
	return source.length > 1 && /[0-9A-Za-z]/.test( source );
}

function omitDegenerateReplacements(
	replacements: Map< string, string >,
	rejectedKeys?: Set< string >
): Map< string, string > {
	const values = new Map< string, string >();
	for ( const [ source, local ] of replacements ) {
		if ( ! isSubstitutableReplacementKey( source ) ) {
			if ( source ) rejectedKeys?.add( source );
			continue;
		}
		values.set( source, local );
	}
	return values;
}

function replaceAll(
	content: string,
	replacements: Map< string, string >,
	rejectedKeys?: Set< string >
): string {
	const values = new Map< string, string >();
	for ( const [ source, local ] of omitDegenerateReplacements( replacements, rejectedKeys ) ) {
		values.set( source, local );
		values.set( source.replace( /&/g, '&amp;' ), local.replace( /&/g, '&amp;' ) );
	}
	const sources = [ ...values.keys() ]
		.filter( ( source ) => source !== '' && source !== '/' )
		.sort( ( a, b ) => b.length - a.length );
	if ( sources.length === 0 ) return content;
	const pattern = new RegExp(
		sources.map( ( source ) => source.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ).join( '|' ),
		'g'
	);
	return content.replace( pattern, ( source ) => values.get( source ) ?? source );
}

function renderedHtml( html: string ): string {
	const $ = cheerio.load( html.replace( /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '' ) );
	$( 'img[src],img[srcset]' ).each( ( _index, element ) => {
		const node = $( element );
		const source = `${ node.attr( 'src' ) ?? '' },${ node.attr( 'srcset' ) ?? '' }`;
		const alignment = /(?:^|[,/])al_(tl|tc|tr|bl|bc|br|t|b|l|c|r)(?=[,/]|$)/i
			.exec( source )?.[ 1 ]
			?.toLowerCase();
		if ( ! alignment ) return;
		const positions: Record< string, string > = {
			tl: 'left top',
			tc: 'center top',
			tr: 'right top',
			bl: 'left bottom',
			bc: 'center bottom',
			br: 'right bottom',
			t: 'center top',
			b: 'center bottom',
			l: 'left center',
			c: 'center center',
			r: 'right center',
		};
		const style = node.attr( 'style' ) ?? '';
		if ( /(?:^|;)\s*object-position\s*:/i.test( style ) ) return;
		const prefix = style.trim() ? style.trim().replace( /;?$/, ';' ) : '';
		node.attr( 'style', `${ prefix }object-position:${ positions[ alignment ] }` );
	} );
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		const style = node.attr( 'style' ) ?? '';
		if ( ! /(?:^|;)\s*position\s*:\s*fixed\s*!important/i.test( style ) ) return;
		const text = node.text().replace( /\s+/g, ' ' ).trim();
		const links = node
			.find( 'a[href]' )
			.map( ( _i, link ) => $( link ).attr( 'href' ) ?? '' )
			.get()
			.join( ' ' );
		if (!isSourcePromotion(`${text} ${links}`))
			return;
		const height = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\s*!important/i.exec( style )?.[ 1 ];
		const bodyStyle = $( 'body' ).attr( 'style' ) ?? '';
		if (
			height &&
			new RegExp( `(?:^|;)\\s*padding-bottom\\s*:\\s*${ height }px\\s*!important`, 'i' ).test(
				bodyStyle
			)
		) {
			$( 'body' ).attr(
				'style',
				bodyStyle
					.replace(
						new RegExp( `(?:^|;)\\s*padding-bottom\\s*:\\s*${ height }px\\s*!important`, 'i' ),
						''
					)
					.replace( /^\s*;|;\s*$/g, '' )
					.trim()
			);
		}
		node.remove();
	} );
	$( 'div,section,aside,footer' ).each( ( _index, element ) => {
		const node = $( element );
		const rendered = node.clone();
		rendered.find( 'script,style,noscript' ).remove();
		if (
			rendered.find( 'img,video,audio,iframe,form,input,button,a[href]' ).length > 0 ||
			rendered.text().trim() !== ''
		)
			return;
		if ( node.parents( 'main,article' ).length > 0 ) return;
		const style = node.attr( 'style' ) ?? '';
		const idAndClass = `${ node.attr( 'id' ) ?? '' } ${ node.attr( 'class' ) ?? '' }`;
		// A site footer is authored page structure, not runtime scaffolding, and
		// it is routinely built from empty boxes that carry their band's height
		// and background in CSS. Matching the name `footer` alone deleted that
		// landmark and collapsed the band it reserved. Judge a landmark by where
		// it sits instead: a detached overlay still matches the style test below.
		const isContentInfoLandmark =
			node.is( 'footer' ) ||
			/(?:^|\s)contentinfo(?:\s|$)/i.test( node.attr( 'role' ) ?? '' );
		if (
			/(?:^|;)\s*(?:position\s*:\s*(?:fixed|absolute)|bottom\s*:)/i.test( style ) ||
			( ! isContentInfoLandmark &&
				/(?:account.*app|app.*account|footer|modal|mount|portal|popup|toast)/i.test(
					idAndClass
				) )
		) {
			node.remove();
		}
	} );
	const allLinks = $( 'body a[href]' )
		.map( ( _index, link ) => $( link ).attr( 'href' ) ?? '' )
		.get();
	$( 'body > div,body > nav' ).each( ( _index, element ) => {
		const node = $( element );
		const style = `${ node.attr( 'style' ) ?? '' };${
			node.children().first().attr( 'style' ) ?? ''
		}`;
		const links = node
			.find( 'a[href]' )
			.map( ( _i, link ) => $( link ).attr( 'href' ) ?? '' )
			.get();
		if ( links.length === 0 || ! /(?:^|;)\s*display\s*:\s*none/i.test( style ) ) return;
		if (
			links.every( ( href ) => allLinks.filter( ( candidate ) => candidate === href ).length > 1 )
		)
			node.remove();
	} );
	return $.html();
}

function normalizedDeclarativeFormEmbeds( html: string ): string {
	if ( ! /<div\b[^>]*\bhs-form-frame\b/i.test( html ) ) return html;
	const $ = cheerio.load( html );
	let retained = 0;
	$( 'div.hs-form-frame' ).each( ( _index, element ) => {
		const frame = $( element );
		frame.find( 'iframe' ).remove();
		if ( retained >= MAX_DECLARATIVE_FORM_EMBEDS ) return;

		const portalId = frame.attr( 'data-portal-id' ) ?? '';
		const formId = ( frame.attr( 'data-form-id' ) ?? '' ).toLowerCase();
		const region = ( frame.attr( 'data-region' ) ?? '' ).toLowerCase();
		const host = HUBSPOT_FORM_HOSTS.get( region );
		if (
			! host ||
			! /^\d{1,20}$/.test( portalId ) ||
			! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test( formId )
		)
			return;

		frame.append(
			`<iframe src="https://${ host }/forms/embed/v2/?portalId=${ portalId }&amp;formId=${ formId }&amp;region=${ region }" title="HubSpot form" loading="lazy"></iframe>`
		);
		retained++;
	} );
	return $.html();
}

function openGraphUrl( html: string ): string | undefined {
	return cheerio.load( html )( 'meta[property="og:url"]' ).first().attr( 'content' );
}

function canonicalMetadataUrl( value: unknown, documentUrl: string ): string | undefined {
	if ( typeof value !== 'string' || value.trim() === '' ) return undefined;
	try {
		const resolved = new URL( value, documentUrl );
		if ( resolved.protocol !== 'http:' && resolved.protocol !== 'https:' ) return undefined;
		return resolved.href;
	} catch {
		return undefined;
	}
}

/**
 * Class tokens marking one side of a desktop/mobile document pair emitted
 * directly into a single exported page (see `mergeResponsiveDocuments`
 * below). Consumers that need to recognize these as a document-scope
 * boundary (e.g. to disambiguate a duplicate id captured on both sides)
 * cannot assume this naming — it is declared explicitly in the capture
 * receipt's `document_scope_classes` list rather than hardcoded downstream.
 */
const DESKTOP_DOCUMENT_CLASS = 'data-liberation-desktop-document';
const MOBILE_DOCUMENT_CLASS = 'data-liberation-mobile-document';

const RESPONSIVE_DOCUMENT_CSS = `html,body{margin:0;padding:0}.${ MOBILE_DOCUMENT_CLASS }{display:none!important}`;

const RESPONSIVE_COUNTERPART_CLASS_PREFIX = 'data-liberation-responsive-counterpart-';
const RESPONSIVE_COUNTERPART_TAGS = 'p,h1,h2,h3,h4,h5,h6,a,button';
const RESPONSIVE_SOURCE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

/** Switches which captured document is shown, at the detected width. */
function documentSwitchCss( switchWidth: number ): string {
	return `@media(max-width:${ switchWidth }px){.${ DESKTOP_DOCUMENT_CLASS }{display:none!important}.${ MOBILE_DOCUMENT_CLASS }{display:contents!important}}`;
}

/**
 * Fallback switch width, used only when the source gave us nothing to detect
 * from. A detected canvas floor is always preferred: the width a document stops
 * adapting at is the source's own switching point, and asserting 768px on a
 * site whose canvas floor is 980px puts the switch in the wrong place.
 */
const DEFAULT_SWITCH_WIDTH = 768;

/**
 * Attributes DLA's own capture infrastructure writes to mark that two
 * elements correspond across viewports: fluid-learning identities
 * (viewport-prefixed, e.g. `desktop-wrapper-0` vs `mobile-wrapper-0`) and
 * responsive counterpart slots. They cannot exist on the source site and
 * encode correspondence, never difference, so structural equivalence must
 * not read them as one.
 */
const CORRESPONDENCE_ATTRIBUTES = [ 'data-dla-geometry-id', 'data-dla-responsive-source' ];
const STRUCTURAL_SIGNATURE_ATTRIBUTES = new Set( [ 'id', 'href', 'name', 'type', 'for', 'action' ] );
const YUI_RUNTIME_ID = /yui_/i;
const CAPTURE_GEOMETRY_ID = /^(?:desktop|mobile)-(?:target|wrapper)-\d+/i;
const UUID_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isYuiRuntimeId( id: string ): boolean {
	return YUI_RUNTIME_ID.test( id );
}

function isUnstableResponsiveId( id: string ): boolean {
	return id
		.split( /\s+/ )
		.some(
			( token ) =>
				isYuiRuntimeId( token ) || CAPTURE_GEOMETRY_ID.test( token ) || UUID_ID.test( token )
		);
}

/**
 * Whether the source served a genuinely different document under mobile
 * emulation, rather than the same one. The comparison is the element tree,
 * ordering, and structural attributes. Runtime ids, capture infrastructure
 * attributes, all text content, and embed hosts (iframes that hydrated on
 * one viewport and not the other) do not masquerade as a second design.
 * Text is ignored because desktop and mobile captures are taken seconds
 * apart, so any live value — a countdown, a cart count, relative time —
 * would otherwise ship two copies of the same responsive document.
 */
export function documentsDiffer( desktopHtml: string, mobileHtml: string ): boolean {
	const desktopBody = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( desktopHtml )?.[ 2 ];
	const mobileBody = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( mobileHtml )?.[ 2 ];
	if ( desktopBody === undefined || mobileBody === undefined ) return false;
	return responsiveBodySignature( desktopBody ) !== responsiveBodySignature( mobileBody );
}

/**
 * Per-route record of how many responsive documents were exported and why,
 * so downstream consumers and humans can audit the collapse decision from
 * the capture receipt alone. Present only when the source was captured under
 * mobile emulation too — without a second capture there was no decision.
 */
export interface ResponsiveVariantEvidence {
	/** Documents shipped in the exported route file. */
	variants: 1 | 2;
	outcome: 'collapsed-equivalent' | 'dual-structural';
	reason: string;
	/** How responsive CSS survives a collapse. Present only when collapsed. */
	css?: 'shared' | 'viewport-scoped';
}

function responsiveVariantEvidence(
	desktopHtml: string,
	mobileHtml: string | undefined
): ResponsiveVariantEvidence | undefined {
	if ( mobileHtml === undefined ) return undefined;
	if ( documentsDiffer( desktopHtml, mobileHtml ) ) {
		return {
			variants: 2,
			outcome: 'dual-structural',
			reason: 'mobile document differs structurally from desktop; both variants shipped',
		};
	}
	const sharedStyles =
		styleBlocks( desktopHtml ).join( '\n' ) === styleBlocks( mobileHtml ).join( '\n' );
	return {
		variants: 1,
		outcome: 'collapsed-equivalent',
		reason:
			'mobile document is structurally equivalent to desktop once capture-infrastructure attributes are normalized; shipped one document',
		css: sharedStyles ? 'shared' : 'viewport-scoped',
	};
}

/**
 * Entrance animations a builder starts from script cannot run in a captured
 * document, because capture strips the script. Re-bind them to the scroll
 * timeline so the authored motion survives.
 */
function withScrollDrivenAnimations( html: string ): string {
	const sourceCss = styleBlocks( html ).join( '\n' );
	if ( sourceCss === '' ) return html;
	const override = appendScrollDrivenAnimations( '', sourceCss );
	if ( override === '' ) return html;
	return /<\/head\s*>/i.test( html )
		? html.replace( /<\/head\s*>/i, `<style>${ override }</style></head>` )
		: `${ html }<style>${ override }</style>`;
}

function responsiveHtml(
	desktopHtml: string,
	mobileHtml: string,
	switchWidth: number = DEFAULT_SWITCH_WIDTH
): string {
	return withScrollDrivenAnimations(
		withMobileLinkedStyles(
			assembleResponsiveHtml( desktopHtml, mobileHtml, switchWidth ),
			mobileHtml,
			switchWidth
		)
	);
}

function withMobileLinkedStyles( html: string, mobileHtml: string, switchWidth: number ): string {
	const mobileHead = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec( mobileHtml )?.[ 1 ];
	if ( ! mobileHead || ! /<link\b/i.test( mobileHead ) ) return html;
	return html.replace( /(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i, ( _match, open: string, head: string, close: string ) => {
		const $ = cheerio.load( head, undefined, false );
		const mobile = cheerio.load( mobileHead, undefined, false );
		const selector = 'style,link[rel~="stylesheet" i][href]:not([rel~="alternate" i]):not([disabled])';
		const key = ( node: cheerio.Cheerio< AnyNode > ): string =>
			node.is( 'style' )
				? `style:${ node.html()?.trim() }`
				: `link:${ node.attr( 'href' ) }:${ node.attr( 'media' ) ?? '' }`;
		const existing = new Map< string, cheerio.Cheerio< AnyNode > >(
			$( selector ).toArray().map( node => [ key( $( node ) ), $( node ) ] )
		);
		const mobileStyles = mobile( selector ).toArray();
		for ( let index = 0; index < mobileStyles.length; index++ ) {
			const link = mobile( mobileStyles[ index ] );
			if ( ! link.is( 'link' ) || ! link.attr( 'href' ) || existing.has( key( link ) ) ) continue;
			// Separate media gates preserve query lists and negated source media without
			// rewriting their logic. The import is localized by the normal resource pass.
			const href = JSON.stringify( link.attr( 'href' ) ).replace( /</g, '\\3c ' );
			const style = $( '<style>' )
				.attr( 'media', link.attr( 'media' ) ?? 'all' )
				.text( `@import url(${ href }) (max-width:${ switchWidth }px);` );
			const following = mobileStyles.slice( index + 1 )
				.map( node => existing.get( key( mobile( node ) ) ) ).find( Boolean );
			const preceding = mobileStyles.slice( 0, index ).reverse()
				.map( node => existing.get( key( mobile( node ) ) ) ).find( Boolean );
			if ( following ) following.before( style );
			else if ( preceding ) preceding.after( style );
			else $.root().append( style );
			existing.set( key( link ), style );
		}
		return `${ open }${ $.html() }${ close }`;
	} );
}

/**
 * Marks corresponding editable leaves from source identity, without comparing
 * their content or visual geometry. The nearest unique source id owns a leaf's
 * tag-relative slot even when the two responsive documents wrap it differently.
 */
function markResponsiveCounterparts(
	desktopBody: string,
	mobileBody: string
): { desktopBody: string; mobileBody: string } {
	if ( ! /\sid\s*=\s*["']/i.test( desktopBody ) || ! /\sid\s*=\s*["']/i.test( mobileBody ) )
		return { desktopBody, mobileBody };
	type Candidate = { node: Element; source: string };
	const collect = ( body: string ) => {
		const $ = cheerio.load( `<body>${ body }</body>` );
		const idCounts = new Map< string, number >();
		$( '[id]' ).each( ( _index, element ) => {
			const id = $( element ).attr( 'id' ) ?? '';
			if ( RESPONSIVE_SOURCE_ID.test( id ) ) idCounts.set( id, ( idCounts.get( id ) ?? 0 ) + 1 );
		} );
		const slots = new Map< string, number >();
		const candidates = new Map< string, Candidate >();
		$( RESPONSIVE_COUNTERPART_TAGS ).each( ( _index, element ) => {
			const node = $( element );
			const owner = node.closest( '[id]' );
			const sourceId = owner.attr( 'id' ) ?? '';
			if ( idCounts.get( sourceId ) !== 1 ) return;
			const tag = element.name.toLowerCase();
			const slotKey = `${ sourceId }\0${ tag }`;
			const slot = ( slots.get( slotKey ) ?? 0 ) + 1;
			slots.set( slotKey, slot );
			const source = `${ sourceId }:${ tag }:${ slot }`;
			candidates.set( source, { node: element, source } );
		} );
		return { $, candidates };
	};

	const desktop = collect( desktopBody );
	const mobile = collect( mobileBody );
	for ( const [ source, desktopCandidate ] of desktop.candidates ) {
		const mobileCandidate = mobile.candidates.get( source );
		if ( ! mobileCandidate ) continue;
		const token = `${ RESPONSIVE_COUNTERPART_CLASS_PREFIX }${ createHash( 'sha256' )
			.update( `mobile\0${ source }` )
			.digest( 'hex' )
			.slice( 0, 12 ) }`;
		for ( const [ $, candidate ] of [
			[ desktop.$, desktopCandidate ],
			[ mobile.$, mobileCandidate ],
		] as const ) {
			const node = $( candidate.node );
			node.addClass( token );
			node.attr( 'data-dla-responsive-source', candidate.source );
		}
	}
	return {
		desktopBody: desktop.$( 'body' ).html() ?? desktopBody,
		mobileBody: mobile.$( 'body' ).html() ?? mobileBody,
	};
}

function assembleResponsiveHtml(
	desktopHtml: string,
	mobileHtml: string,
	switchWidth: number = DEFAULT_SWITCH_WIDTH
): string {
	const desktopBodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( desktopHtml );
	let desktopBody = desktopBodyMatch?.[ 2 ];
	const mobileBodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( mobileHtml );
	let mobileBody = mobileBodyMatch?.[ 2 ];
	if ( desktopBody === undefined || mobileBody === undefined ) return desktopHtml;
	const mobileViewport = /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i.exec(
		mobileHtml
	)?.[ 0 ];
	const withMobileViewport = ( html: string ): string => {
		if ( ! mobileViewport ) return html;
		return /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i.test( html )
			? html.replace( /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i, mobileViewport )
			: html.replace( /<\/head\s*>/i, `${ mobileViewport }</head>` );
	};
	if ( responsiveBodySignature( desktopBody ) === responsiveBodySignature( mobileBody ) ) {
		if ( styleBlocks( desktopHtml ).join( '\n' ) === styleBlocks( mobileHtml ).join( '\n' ) )
			return withMobileViewport( desktopHtml );
		// A stylesheet present in both captures must apply at every width, so it is
		// left out of both scoping passes below and kept exactly once, unscoped, from
		// the desktop copy that already carries it.
		const shared = sharedStyleContents( desktopHtml, mobileHtml );
		return withMobileViewport(
			scopedStyles( desktopHtml, `(min-width:${ switchWidth + 1 }px)`, shared )
		).replace(
			/<\/head\s*>/i,
			`${ responsiveMobileStyles( mobileHtml, undefined, switchWidth, shared ) }</head>`
		);
	}
	( { desktopBody, mobileBody } = markResponsiveCounterparts( desktopBody, mobileBody ) );

	// Both documents ship in one file from here on, so their anchor targets would
	// collide on a shared id. Namespace the mobile copy and repoint its own links.
	const desktop = cheerio.load( `<body>${ desktopBody }</body>` );
	const desktopTargets = new Map< string, string >();
	desktop( '[data-dla-anchor-target][data-dla-anchor-source-id]' ).each( ( _index, element ) => {
		const target = desktop( element );
		const fragment = target.attr( 'data-dla-anchor-target' );
		const sourceId = target.attr( 'data-dla-anchor-source-id' );
		if ( fragment && sourceId ) desktopTargets.set( fragment, sourceId );
	} );
	const mobile = cheerio.load( `<body>${ mobileBody }</body>` );
	mobile( 'a[data-dla-anchor-fragment]' ).each( ( _index, element ) => {
		const fragment = mobile( element ).attr( 'data-dla-anchor-fragment' );
		const sourceId = fragment ? desktopTargets.get( fragment ) : undefined;
		if ( ! fragment || mobile( `[data-dla-anchor-target="${ fragment }"]` ).length > 0 ) return;
		if ( sourceId ) {
			const counterpart = mobile( '[id]' )
				.filter( ( _i, candidate ) => mobile( candidate ).attr( 'id' ) === sourceId )
				.first();
			if ( counterpart.length === 1 ) {
				counterpart.attr( 'data-dla-anchor-target', fragment );
				return;
			}
		}
		const localTarget = mobile( '[id]' )
			.filter( ( _i, candidate ) => mobile( candidate ).attr( 'id' ) === fragment )
			.first();
		if ( localTarget.length === 1 ) localTarget.attr( 'data-dla-anchor-target', fragment );
	} );
	mobile( '[data-dla-anchor-target]' ).each( ( _index, element ) => {
		const node = mobile( element );
		const fragment = node.attr( 'data-dla-anchor-target' );
		if ( fragment ) node.attr( 'id', `${ fragment }--dla-mobile` );
	} );
	mobile( 'a[data-dla-anchor-fragment][href]' ).each( ( _index, element ) => {
		const node = mobile( element );
		const fragment = node.attr( 'data-dla-anchor-fragment' );
		const href = node.attr( 'href' );
		if ( fragment && href )
			node.attr(
				'href',
				`${ href.replace( /#.*$/, '' ) }#${ encodeURIComponent( fragment ) }--dla-mobile`
			);
	} );
	mobileBody = mobile( 'body' ).html() ?? mobileBody;

	const wrapperAttributes = ( baseClass: string, bodyAttributes: string ): string => {
		const body = cheerio.load( `<body${ bodyAttributes }></body>` )( 'body' );
		const className = [ baseClass, body.attr( 'class' ) ].filter( Boolean ).join( ' ' );
		const style = body.attr( 'style' );
		return `class="${ escapeHtmlAttr( className ) }"${
			style ? ` style="${ escapeHtmlAttr( style ) }"` : ''
		}`;
	};
	const bodyClasses = ( bodyAttributes: string ): string[] =>
		( cheerio.load( `<body${ bodyAttributes }></body>` )( 'body' ).attr( 'class' ) ?? '' )
			.split( /\s+/ )
			.filter( Boolean );
	const mobileBodyClasses = new Set( bodyClasses( mobileBodyMatch?.[ 1 ] ?? '' ) );
	const sharedBodyClasses = [ ...new Set( bodyClasses( desktopBodyMatch?.[ 1 ] ?? '' ) ) ].filter(
		( className ) => mobileBodyClasses.has( className )
	);
	const outerBody = `<body${
		sharedBodyClasses.length > 0
			? ` class="${ escapeHtmlAttr( sharedBodyClasses.join( ' ' ) ) }"`
			: ''
	}>`;
	const responsiveBody = `<div ${ wrapperAttributes(
		DESKTOP_DOCUMENT_CLASS,
		desktopBodyMatch?.[ 1 ] ?? ''
	) }>${ desktopBody }</div><div ${ wrapperAttributes(
		MOBILE_DOCUMENT_CLASS,
		mobileBodyMatch?.[ 1 ] ?? ''
	) }>${ mobileBody }</div>`;
	const sharedStyles = styleBlocks( desktopHtml );
	if (
		sharedStyles.length > 0 &&
		sharedStyles.join( '\n' ) === styleBlocks( mobileHtml ).join( '\n' )
	) {
		return withMobileViewport( desktopHtml )
			.replace(
				/<\/head\s*>/i,
				`<style>${ RESPONSIVE_DOCUMENT_CSS }${ documentSwitchCss( switchWidth ) }</style></head>`
			)
			.replace(
				/<body\b[^>]*>[\s\S]*?(<\/body\s*>)/i,
				( _match, closingBody: string ) => `${ outerBody }${ responsiveBody }${ closingBody }`
			);
	}
	// A stylesheet present in both captures must apply at every width, so it is
	// left out of both scoping passes below and kept exactly once, unscoped, from
	// the desktop copy that already carries it.
	const shared = sharedStyleContents( desktopHtml, mobileHtml );
	const mobileStyles = responsiveMobileStyles(
		mobileHtml,
		`.${ MOBILE_DOCUMENT_CLASS }`,
		switchWidth,
		shared
	);
	return withMobileViewport(
		scopedStyles( desktopHtml, `(min-width:${ switchWidth + 1 }px)`, shared )
	)
		.replace(
			/<\/head\s*>/i,
			`${ mobileStyles }<style>${ RESPONSIVE_DOCUMENT_CSS }${ documentSwitchCss( switchWidth ) }</style></head>`
		)
		.replace(
			/<body\b[^>]*>[\s\S]*?(<\/body\s*>)/i,
			( _match, closingBody: string ) => `${ outerBody }${ responsiveBody }${ closingBody }`
		);
}

function styleBlocks( html: string ): string[] {
	return [ ...html.matchAll( /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi ) ].map( ( match ) =>
		match[ 1 ].trim()
	);
}

/**
 * Stylesheet content present in both captures. A stylesheet keyed here must
 * survive assembly unscoped rather than being narrowed to whichever viewport's
 * copy happens to be kept, because the source served it to both.
 */
function sharedStyleContents( desktopHtml: string, mobileHtml: string ): Set< string > {
	const desktopBlocks = new Set( styleBlocks( desktopHtml ) );
	return new Set( styleBlocks( mobileHtml ).filter( ( block ) => desktopBlocks.has( block ) ) );
}

export function portableInlineStyle(
	attributes: string,
	css: string
): { key: string; media: string } | undefined {
	const mediaMatch = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec( attributes );
	const typeCount = ( attributes.match( /\btype\s*=/gi ) ?? [] ).length;
	const mediaCount = ( attributes.match( /\bmedia\s*=/gi ) ?? [] ).length;
	const unsupportedAttributes = attributes
		// Only inert stylesheet attributes may be represented by a link.
		.replace( /\btype\s*=\s*(["'])text\/css\1/gi, '' )
		.replace( /\bmedia\s*=\s*(["']).*?\1/gi, '' )
		.trim();
	return portableInlineStyleValues(
		mediaMatch?.[ 2 ] ?? '',
		typeCount > 1 || mediaCount > 1 || unsupportedAttributes !== '',
		css
	);
}

function portableInlineStyleValues(
	media: string,
	hasUnsupportedAttributes: boolean,
	css: string
): { key: string; media: string } | undefined {
	if ( hasUnsupportedAttributes || css.trim() === '' )
		return undefined;
	// eslint-disable-next-line no-control-regex -- reject unprintable media attributes.
	if ( /[\u0000-\u001f\u007f<>&]/.test( media ) ) return undefined;
	return { key: `${ media }\n${ css }`, media };
}

type StyleHoistReason =
	| 'unsafe_attributes'
	| 'invalid_media'
	| 'empty_style'
	| 'relative_css_url'
	| 'fragment_css_url'
	| 'empty_css_url'
	| 'invalid_css_url'
	| 'css_import'
	| 'document_base'
	| 'content_security_policy';

interface StyleHoistDiagnostic {
	sourceUrl: string;
	reason: StyleHoistReason;
}

interface BoundedStyleHoistDiagnostics {
	diagnostics: StyleHoistDiagnostic[];
	diagnosticCounts: Partial< Record< StyleHoistReason, number > >;
	diagnosticsTruncated: boolean;
}

interface StyleHoistDiagnosticCollector extends BoundedStyleHoistDiagnostics {
	diagnosticBytes: number;
}

interface StyleHoistContext {
	hasBase: boolean;
	hasContentSecurityPolicy: boolean;
	styleReasons: Array< StyleHoistReason | undefined >;
}

function cssReferenceReason( css: string ): StyleHoistReason | undefined {
	// Current limitation: @import remains inline because it has stylesheet-relative
	// semantics even when its first URL is absolute.
	if ( /@import\b/i.test( css ) ) return 'css_import';
	const urlPattern = /url\(\s*([^)]*?)\s*\)/gi;
	let foundUrl = false;
	let match: RegExpExecArray | null;
	while ( ( match = urlPattern.exec( css ) ) !== null ) {
		foundUrl = true;
		const reference = match[ 1 ].trim().replace( /^(?:["'])|(?:["'])$/g, '' );
		if ( reference === '' ) return 'empty_css_url';
		// Root, data, and absolute URLs retain their meaning at the new CSS path.
		// A fragment resolves against the stylesheet itself, not the document, after a move.
		if ( reference.startsWith( '#' ) ) return 'fragment_css_url';
		if ( reference.startsWith( '/' ) && ! reference.startsWith( '//' ) ) continue;
		// `about:blank` is the unavailable-asset sentinel this export writes for a
		// dependency it could not capture. Like data: and absolute URLs it resolves
		// identically from any base, so it must not disable hoisting for every
		// document that lost an asset.
		if ( /^(?:data:|https?:|about:blank\b)/i.test( reference ) ) continue;
		if ( /^[a-z][a-z0-9+.-]*:/i.test( reference ) ) return 'invalid_css_url';
		return 'relative_css_url';
	}
	if ( ! foundUrl && /url\s*\(/i.test( css ) ) return 'invalid_css_url';
}

function capturedStyleHoistContext( html: string ): StyleHoistContext {
	const styleReasons: Array< StyleHoistReason | undefined > = [];
	for ( const match of html.matchAll( /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi ) )
		styleReasons.push( cssReferenceReason( match[ 1 ] ) );
	return {
		// These deliberately broad scans only disable hoisting. Avoid building a second
		// DOM for every captured document, which exceeds the constrained export heap.
		hasBase: /<base\b/i.test( html ),
		hasContentSecurityPolicy:
			/<meta\b(?=[^>]*\bhttp-equiv\b)[^>]*\bcontent-security-policy\b/i.test( html ),
		styleReasons,
	};
}

function styleHoistReason(
	entry: CaptureEntry,
	styleIndex: number,
	attributes: string,
	css: string
): StyleHoistReason | undefined {
	if ( entry.styleHoistContext.hasBase ) return 'document_base';
	if ( entry.styleHoistContext.hasContentSecurityPolicy ) return 'content_security_policy';
	const sourceReason = entry.styleHoistContext.styleReasons[ styleIndex ];
	if ( sourceReason ) return sourceReason;
	if ( css.trim() === '' ) return 'empty_style';
	const style = portableInlineStyle( attributes, css );
	if ( style ) return cssReferenceReason( css );
	const media = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec( attributes )?.[ 2 ] ?? '';
	// eslint-disable-next-line no-control-regex -- reject unprintable media attributes.
	return /[\u0000-\u001f\u007f<>&]/.test( media ) ? 'invalid_media' : 'unsafe_attributes';
}

function createStyleHoistDiagnosticCollector(): StyleHoistDiagnosticCollector {
	return { diagnostics: [], diagnosticCounts: {}, diagnosticsTruncated: false, diagnosticBytes: 0 };
}

function recordStyleHoistDiagnostic(
	collector: StyleHoistDiagnosticCollector,
	diagnostic: StyleHoistDiagnostic
): void {
	collector.diagnosticCounts[ diagnostic.reason ] =
		( collector.diagnosticCounts[ diagnostic.reason ] ?? 0 ) + 1;
	const bytes = Buffer.byteLength( JSON.stringify( diagnostic ) );
	const separator = collector.diagnostics.length === 0 ? 0 : 1;
	// Leave room for the aggregate counts and object syntax without repeatedly serializing samples.
	if ( collector.diagnosticBytes + separator + bytes > STYLE_HOIST_DIAGNOSTIC_SAMPLE_BYTES ) {
		collector.diagnosticsTruncated = true;
		return;
	}
	collector.diagnostics.push( diagnostic );
	collector.diagnosticBytes += separator + bytes;
}

function responsiveMobileStyles(
	mobileHtml: string,
	scope?: string,
	switchWidth: number = DEFAULT_SWITCH_WIDTH,
	skip: ReadonlySet< string > = new Set()
): string {
	return styleBlocks( mobileHtml )
		.filter( ( style ) => style !== '' && ! skip.has( style ) )
		.map(
			( style ) =>
				`<style media="(max-width:${ switchWidth }px)">${ scope ? scopeCss( style, { scope } ) : style }</style>`
		)
		.join( '' );
}

function scopedStyles(
	html: string,
	media: string,
	skip: ReadonlySet< string > = new Set()
): string {
	return html.replace(
		/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
		( _match, attributes: string, css: string ) => {
			if ( skip.has( css.trim() ) ) return `<style${ attributes }>${ css }</style>`;
			const existingMedia = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec( attributes );
			if ( ! existingMedia ) return `<style${ attributes } media="${ media }">${ css }</style>`;
			const combined = `${ media } and (${ existingMedia[ 2 ] })`;
			const scopedAttributes = attributes.replace(
				existingMedia[ 0 ],
				`media=${ existingMedia[ 1 ] }${ combined }${ existingMedia[ 1 ] }`
			);
			return `<style${ scopedAttributes }>${ css }</style>`;
		}
	);
}

function responsiveBodySignature( body: string ): string {
	const $ = cheerio.load( `<body>${ body }</body>` );
	$( 'script,style,noscript,iframe' ).remove();
	$( '[id]' ).each( ( _index, element ) => {
		if ( isYuiRuntimeId( $( element ).attr( 'id' ) ?? '' ) ) $( element ).remove();
	} );
	$( 'svg,map,area,picture,source,img,canvas,slot' ).remove();
	$( '*' )
		.contents()
		.each( ( _index, child ) => {
			if ( child.type === 'comment' ) $( child ).remove();
		} );
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		for ( const attribute of Object.keys( 'attribs' in element ? element.attribs : {} ) ) {
			if ( ! STRUCTURAL_SIGNATURE_ATTRIBUTES.has( attribute ) ) node.removeAttr( attribute );
		}
		for ( const attribute of [ 'id', 'name' ] ) {
			const value = node.attr( attribute );
			if ( value && isUnstableResponsiveId( value ) ) node.removeAttr( attribute );
		}
		if ( node.is( 'form,iframe' ) ) {
			for ( const attribute of [ 'id', 'name', 'target' ] ) {
				const value = node.attr( attribute );
				if ( value && /(?:target|frame)[-_]?\d{6,}$/i.test( value ) )
					node.attr( attribute, 'capture-target' );
			}
		}
	} );
	let removedEmptyMount = true;
	while ( removedEmptyMount ) {
		removedEmptyMount = false;
		$( 'div,span' ).each( ( _index, element ) => {
			const node = $( element );
			if (
				Object.keys( 'attribs' in element ? element.attribs : {} ).length === 0 &&
				node.children().length === 0 &&
				node.text().trim() === ''
			) {
				node.remove();
				removedEmptyMount = true;
			}
		} );
	}
	$( '*' )
		.contents()
		.each( ( _index, child ) => {
			if ( child.type === 'text' ) child.data = '';
		} );
	return ( $( 'body' ).html() ?? '' ).replace( />\s+</g, '><' ).replace( /\s+/g, ' ' ).trim();
}

function mediaReferences( sourceUrl: string, siteUrl: string ): string[] {
	const media = new URL( sourceUrl );
	const site = new URL( siteUrl );
	if ( media.origin !== site.origin ) return [ sourceUrl ];
	if ( media.pathname === '/' ) return [ sourceUrl ];
	return [ sourceUrl, `${ media.pathname }${ media.search }` ];
}

function containsMediaReference( content: string, reference: string ): boolean {
	for ( const candidate of [ reference, reference.replace( /&/g, '&amp;' ) ] ) {
		let offset = content.indexOf( candidate );
		while ( offset !== -1 ) {
			const suffix = content.slice( offset + candidate.length );
			if (
				new URL( reference, 'https://example.com' ).search ||
				( ! suffix.startsWith( '?' ) && ! suffix.startsWith( '&amp;' ) )
			) {
				return true;
			}
			offset = content.indexOf( candidate, offset + candidate.length );
		}
	}
	return false;
}

function srcsetReferences( srcset: string ): string[] {
	const references: string[] = [];
	let offset = 0;
	while ( offset < srcset.length ) {
		while ( offset < srcset.length && /[\s,]/.test( srcset[ offset ] ) ) offset++;
		if ( offset >= srcset.length ) break;
		const start = offset;
		while ( offset < srcset.length && ! /\s/.test( srcset[ offset ] ) ) offset++;
		const reference = srcset.slice( start, offset ).replace( /,+$/, '' );
		if ( reference ) references.push( reference );
		while ( offset < srcset.length && srcset[ offset ] !== ',' ) offset++;
		if ( offset < srcset.length ) offset++;
	}
	return references;
}

function capturedMediaReferences( entries: CaptureEntry[] ): Map< string, Set< string > > {
	const pages = new Set(
		entries.flatMap( ( entry ) => {
			try {
				return [ normalizedUrl( entry.url ) ];
			} catch {
				return [];
			}
		} )
	);
	const families = new Map< string, Set< string > >();
	for ( const entry of entries ) {
		const html = readFileSync( entry.htmlPath, 'utf8' );
		const references: string[] = [];
		for ( const match of html.matchAll(
			/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi
		) ) {
			references.push( match[ 2 ] );
		}
		for ( const match of html.matchAll(
			/<(?:img|source)\b[^>]*\bsrcset\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi
		) ) {
			references.push( ...srcsetReferences( match[ 2 ] ) );
		}
		for ( const reference of references ) {
			const trimmed = reference.trim();
			if ( ! trimmed ) continue;
			try {
				const resolved = new URL( trimmed.replace( /&amp;/g, '&' ), entry.url ).href;
				if ( pages.has( normalizedUrl( resolved ) ) ) continue;
				const family = mediaFamily( resolved );
				families.set( family, new Set( [ ...( families.get( family ) ?? [] ), reference ] ) );
			} catch {
				// Ignore non-URL browser values such as data URIs and malformed placeholders.
			}
		}
	}
	return families;
}

function mediaFamily( sourceUrl: string ): string {
	const url = new URL( sourceUrl );
	const transformedPath = /^(.*?)\/v1\/(?:fill|fit|crop)\//i.exec( url.pathname )?.[ 1 ];
	if ( transformedPath ) return `${ url.origin }${ transformedPath }`;
	const parameters = [ ...url.searchParams.keys() ];
	return parameters.length > 0 && parameters.every( ( key ) => key === 'w' || key === 'h' )
		? `${ url.origin }${ url.pathname }`
		: sourceUrl;
}

function retainedMediaReferencesByFamily( entries: CaptureEntry[] ): Map< string, string[] > {
	const pages = new Set(
		entries.flatMap( ( { url } ) => {
			try {
				return [ normalizedUrl( url ) ];
			} catch {
				return [];
			}
		} )
	);
	const families = new Map< string, string[] >();
	const add = ( reference: string, documentUrl: string ) => {
		const trimmed = reference.trim();
		if ( ! trimmed ) return;
		try {
			const resolved = new URL( trimmed.replace( /&amp;/g, '&' ), documentUrl ).href;
			if ( pages.has( normalizedUrl( resolved ) ) ) return;
			const family = mediaFamily( resolved );
			families.set( family, [
				...( families.get( family ) ?? [] ),
				trimmed.replace( /&amp;/g, '&' ),
			] );
		} catch {
			// Non-URL media sources, such as data URLs, need no localization.
		}
	};
	for ( const { url, htmlPath } of entries ) {
		const html = readFileSync( htmlPath, 'utf8' );
		const $ = cheerio.load( html );
		$( 'img,source,video,audio' ).each( ( _index, element ) => {
			const node = $( element );
			const src = node.attr( 'src' );
			if ( src ) add( src, url );
			const srcset = node.attr( 'srcset' );
			if ( ! srcset ) return;
			for ( const candidate of srcsetReferences( srcset ) ) add( candidate, url );
		} );
	}
	return families;
}

function mediaDimension( sourceUrl: string ): number {
	const url = new URL( sourceUrl );
	const finalTransformation = [
		...url.pathname.matchAll( /\/v1\/(?:fill|fit|crop)\/([^/]+)/gi ),
	].at( -1 )?.[ 1 ];
	const pathDimensions = [
		...( finalTransformation ?? url.pathname ).matchAll( /(?:^|[,/])(?:w|h)_(\d+)/gi ),
	].map( ( match ) => Number( match[ 1 ] ) || 0 );
	return Math.max(
		Number( url.searchParams.get( 'w' ) ) || 0,
		Number( url.searchParams.get( 'h' ) ) || 0,
		...pathDimensions
	);
}

function selectMediaCandidate( candidates: MediaCandidate[] ): MediaCandidate | undefined {
	const bounded = candidates.filter(
		( candidate ) =>
			candidate.bytes <= MAX_PORTABLE_MEDIA_BYTES &&
			candidate.dimension <= MAX_PORTABLE_MEDIA_DIMENSION
	);
	return [ ...bounded ].sort(
		( a, b ) =>
			b.dimension - a.dimension || a.bytes - b.bytes || a.sourceUrl.localeCompare( b.sourceUrl )
	)[ 0 ];
}

function selectMediaCandidates( candidates: MediaCandidate[] ): MediaCandidate[] {
	const dimensionBounded = candidates.filter(
		( candidate ) => candidate.dimension <= MAX_PORTABLE_MEDIA_DIMENSION
	);
	const responsiveFamily =
		dimensionBounded.filter( ( candidate ) => candidate.exactReferences.length > 0 ).length > 1;
	const bounded = dimensionBounded.filter(
		( candidate ) =>
			candidate.bytes <=
			( responsiveFamily ? MAX_PORTABLE_RESPONSIVE_MEDIA_BYTES : MAX_PORTABLE_MEDIA_BYTES )
	);
	const exact = bounded.filter( ( candidate ) => candidate.exactReferences.length > 0 );
	const fallback = selectMediaCandidate( bounded );
	const selected = exact.length > 0 ? exact : fallback ? [ fallback ] : [];
	return [ ...selected ].sort(
		( a, b ) =>
			b.dimension - a.dimension || a.bytes - b.bytes || a.sourceUrl.localeCompare( b.sourceUrl )
	);
}

function portableMediaBasename( candidate: MediaCandidate ): string {
	const localName = basename( candidate.localPath );
	if (
		/^\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mp3|ogg|wav|woff2?|ttf|otf)$/i.test(
			extname( localName )
		)
	) {
		return localName;
	}

	const cleanedUrl = candidate.sourceUrl.replace( /&(?:quot|apos|amp);?$/i, '' );
	const sourceExtension = extname( basename( new URL( cleanedUrl ).pathname ) );
	if (
		! /^\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mp3|ogg|wav|woff2?|ttf|otf)$/i.test(
			sourceExtension
		)
	) {
		return localName;
	}
	return `${ localName.slice(
		0,
		localName.length - extname( localName ).length
	) }${ sourceExtension.toLowerCase() }`;
}

function routeMatchesSourceOrigin( url: string, sourceUrl: string ): boolean {
	const route = new URL( url );
	const source = new URL( sourceUrl );
	return route.origin === source.origin;
}

function capturedResources( outputDir: string ): CapturedResourceManifest {
	const manifestPath = join( outputDir, 'resources', 'manifest.json' );
	if ( ! existsSync( manifestPath ) ) return { version: 1, resources: {}, failures: [] };
	try {
		const manifest = JSON.parse( readFileSync( manifestPath, 'utf8' ) ) as CapturedResourceManifest;
		return manifest.version === 1 && manifest.resources && Array.isArray( manifest.failures )
			? manifest
			: { version: 1, resources: {}, failures: [] };
	} catch {
		return {
			version: 1,
			resources: {},
			failures: [ { url: manifestPath, error: 'captured resource manifest is invalid' } ],
		};
	}
}

function portableResourcePath( path: string, contentType: string ): string | undefined {
	const requestedPath = path.replace( /^resources[\\/]/, '' );
	if ( extname( basename( requestedPath ) ) ) return requestedPath;

	const extension =
		{
			'application/ecmascript': '.js',
			'application/javascript': '.js',
			'application/json': '.json',
			'application/ld+json': '.json',
			'application/pdf': '.pdf',
			'application/xml': '.xml',
			'application/wasm': '.wasm',
			'audio/mpeg': '.mp3',
			'audio/ogg': '.ogg',
			'audio/wav': '.wav',
			'font/otf': '.otf',
			'font/ttf': '.ttf',
			'font/woff': '.woff',
			'font/woff2': '.woff2',
			'image/avif': '.avif',
			'image/gif': '.gif',
			'image/jpeg': '.jpg',
			'image/png': '.png',
			'image/svg+xml': '.svg',
			'image/webp': '.webp',
			'text/css': '.css',
			'text/ecmascript': '.js',
			'text/html': '.html',
			'text/javascript': '.js',
			'text/plain': '.txt',
			'text/xml': '.xml',
			'video/mp4': '.mp4',
			'video/ogg': '.ogg',
			'video/webm': '.webm',
		}[ contentType.toLowerCase().split( ';', 1 )[ 0 ].trim() ] ?? '';

	return extension ? `${ requestedPath }${ extension }` : undefined;
}

function dependencyReferences(
	html: string,
	documentUrl: string,
	cssOnly = false
): PortableDependency[] {
	const searchableHtml = html
		.replace( /&quot;|&#34;|&#x22;/gi, '"' )
		.replace( /&apos;|&#39;|&#x27;/gi, "'" );
	let cssContent = searchableHtml;
	const audioLinks: string[] = [];
	if ( ! cssOnly ) {
		const $ = cheerio.load( html );
		$( 'a[href],area[href]' ).each( ( _, element ) => {
			const href = $( element ).attr( 'href' ) ?? '';
			if ( isAudioLink( href, documentUrl ) ) audioLinks.push( href );
		} );
		cssContent = [
			...$( 'style' )
				.map( ( _index, element ) => $( element ).html() ?? '' )
				.get(),
			...$( '[style]' )
				.map( ( _index, element ) => $( element ).attr( 'style' ) ?? '' )
				.get(),
		]
			.join( '\n' )
			.replace( /&quot;|&#34;|&#x22;/gi, '"' )
			.replace( /&apos;|&#39;|&#x27;/gi, "'" );
	}
	const references = new Set< string >();
	const add = ( reference: string | undefined ) => {
		// A data: or blob: reference already carries its bytes (or points at an
		// in-memory object): it is never a network dependency to resolve, so it
		// must not be recorded, let alone reported as unresolved.
		if ( reference && ! isInlineUrl( reference ) ) references.add( reference.replace( /&amp;/g, '&' ) );
	};
	for ( const href of audioLinks ) add( href );

	const mediaReferences = new Set< string >();
	const cssReferences = new Set< string >();
	for ( const match of searchableHtml.matchAll(
		/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi
	) ) {
		mediaReferences.add( match[ 2 ].replace( /&amp;/g, '&' ) );
		add( match[ 2 ] );
	}
	for ( const match of searchableHtml.matchAll(
		/<video\b[^>]*\bposter\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi
	) ) {
		mediaReferences.add( match[ 2 ].replace( /&amp;/g, '&' ) );
		add( match[ 2 ] );
	}
	for ( const match of searchableHtml.matchAll(
		/<(?:img|source)\b[^>]*\bsrcset\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi
	) ) {
		for ( const reference of srcsetReferences( match[ 2 ] ) ) {
			if ( reference ) {
				mediaReferences.add( reference.replace( /&amp;/g, '&' ) );
				add( reference );
			}
		}
	}
	for ( const match of searchableHtml.matchAll( /<link\b[^>]*>/gi ) ) {
		const tag = match[ 0 ];
		const rel = /\brel\s*=\s*(["'])([\s\S]*?)\1/i.exec( tag )?.[ 2 ].toLowerCase() ?? '';
		const as = /\bas\s*=\s*(["'])([\s\S]*?)\1/i.exec( tag )?.[ 2 ].toLowerCase() ?? '';
		const relations = rel.split( /\s+/ );
		if (
			relations.some( ( value ) => value === 'stylesheet' || /(?:^|-)icon$/.test( value ) ) ||
			( relations.includes( 'preload' ) && [ 'style', 'font', 'image', 'media' ].includes( as ) )
		) {
			add( /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec( tag )?.[ 2 ] );
		}
	}
	for ( const match of searchableHtml.matchAll(
		/\bimport\s+(?:[^"']*?\s+from\s+)?(["'])([\s\S]*?)\1/g
	) ) {
		add( match[ 2 ] );
	}
	for ( const match of cssContent.matchAll(
		/\burl\(\s*(?:(["'])([\s\S]*?)\1|([^\s)'";]+))\s*\)/gi
	) ) {
		const reference = match[ 2 ] ?? match[ 3 ];
		if ( reference && ! reference.startsWith( '#' ) ) {
			cssReferences.add( reference.replace( /&amp;/g, '&' ) );
			add( reference );
		}
	}
	for ( const match of cssContent.matchAll( /@import\s+(?:url\(\s*)?(["'])([\s\S]*?)\1/gi ) ) {
		const reference = match[ 2 ];
		cssReferences.add( reference.replace( /&amp;/g, '&' ) );
		add( reference );
	}

	return [ ...references ].flatMap( ( reference ) => {
		try {
			const url = new URL( reference, documentUrl );
			return [
				{
					reference,
					url: url.href,
					kind: mediaReferences.has( reference )
						? 'media'
						: cssReferences.has( reference )
						? 'css'
						: 'resource',
				},
			];
		} catch {
			return [];
		}
	} );
}

interface AssetEvidenceReferences {
	locations: Map< string, { count: number; references: AssetEvidenceReference[] } >;
	assetCount: number;
	assetCountExact: boolean;
	totalReferenceCount: number;
	documentCount: number;
	cssResourcesTruncated: boolean;
}

function assetReferences(
	entries: CaptureEntry[],
	routePathOf: ( url: string ) => string,
	resourceManifest: CapturedResourceManifest,
	outputDir: string
): AssetEvidenceReferences {
	const locations = new Map< string, { count: number; references: AssetEvidenceReference[] } >();
	let assetCount = 0;
	let assetCountExact = true;
	let totalReferenceCount = 0;
	let documentCount = 0;
	let cssResourcesTruncated = false;
	const add = ( dependency: PortableDependency, location: AssetEvidenceReference ) => {
		totalReferenceCount++;
		let indexed = locations.get( dependency.url );
		if ( !indexed ) {
			if ( locations.size >= MAX_ASSET_EVIDENCE_ASSETS ) {
				// Further URLs are deliberately not indexed: their identity would require an unbounded set.
				assetCountExact = false;
				assetCount = MAX_ASSET_EVIDENCE_ASSETS + 1;
				return;
			}
			indexed = { count: 0, references: [] };
			locations.set( dependency.url, indexed );
			assetCount++;
		}
		indexed.count++;
		if ( indexed.references.length < MAX_ASSET_EVIDENCE_REFERENCES ) indexed.references.push( location );
	};
	for ( const entry of entries ) {
		const path = `website/${ routePathOf( entry.url ) }`;
		const visitedCss = new Set< string >();
		const visit = ( dependency: PortableDependency, document: AssetEvidenceReference[ 'document' ] ) => {
			add( dependency, { route: entry.url, path, document, reference: dependency.reference } );
			if ( visitedCss.size >= MAX_ASSET_EVIDENCE_CSS_RESOURCES_PER_ROUTE ) {
				cssResourcesTruncated = true;
				return;
			}
			if ( visitedCss.has( dependency.url ) ) return;
			const resource = resourceManifest.resources[ dependency.url ];
			if ( !resource || !/text\/css/i.test( resource.contentType ) ) return;
			const resourcePath = resolve( outputDir, resource.path );
			if ( !pathWithin( outputDir, resourcePath ) || !existsSync( resourcePath ) ) return;
			visitedCss.add( dependency.url );
			for ( const nested of dependencyReferences( readFileSync( resourcePath, 'utf8' ), dependency.url, true ) )
				visit( nested, 'css' );
		};
		for ( const source of entry.evidenceDocuments ) {
			documentCount++;
			for ( const dependency of dependencyReferences( source.html, entry.url ) ) visit( dependency, source.state );
		}
	}
	return { locations, assetCount, assetCountExact, totalReferenceCount, documentCount, cssResourcesTruncated };
}

function assetEvidence(
	references: AssetEvidenceReferences,
	mediaStubs: MediaStubStore,
	resourceManifest: CapturedResourceManifest,
	portablePaths: Map< string, string >,
	outputDir: string
): {
	assetCount: number;
	assetCountExact: boolean;
	totalReferenceCount: number;
	assetsTruncated: boolean;
	assets: AssetEvidenceRecord[];
} {
	const sortedUrls = [ ...references.locations.keys() ].sort( ( left, right ) => left.localeCompare( right ) );
	const records = sortedUrls.map( ( url ) => {
		const stub = mediaStubs.get( url );
		const resource = resourceManifest.resources[ url ];
		const path = portablePaths.get( url );
		const included = path !== undefined && existsSync( resolve( outputDir, path ) );
		const resourcePath = resource ? resolve( outputDir, resource.path ) : undefined;
		const retrieved = resourcePath
			? pathWithin( outputDir, resourcePath ) && existsSync( resourcePath )
			: stub?.status === 'success' && stub.localPath !== undefined && existsSync( stub.localPath );
		const reportedSuccess = resource !== undefined || stub?.status === 'success';
		const failure =
			resourceManifest.failures.find( ( candidate ) => candidate.url === url )?.error ??
			( stub?.status === 'error' ? stub.error : undefined ) ??
			( reportedSuccess && !retrieved
				? 'captured asset file is unavailable'
				: retrieved && !included
				? 'retrieved asset was not included in the portable website'
				: undefined );
		const retrieval: AssetEvidenceRecord[ 'retrieval' ] = retrieved
			? 'retrieved'
			: resourceManifest.failures.some( ( candidate ) => candidate.url === url ) || stub?.status === 'error'
			? 'failed'
			: 'unknown';
		const outcome: AssetEvidenceRecord[ 'outcome' ] = included ? 'successful' : failure ? 'failed' : 'unknown';
		const portable: AssetEvidenceRecord[ 'portable' ] = included
			? 'included'
			: retrieval === 'retrieved'
			? 'excluded'
			: 'not-included';
		const indexed = references.locations.get( url )!;
		const locations = indexed.references.sort(
			( left, right ) =>
				left.route.localeCompare( right.route ) ||
				left.document.localeCompare( right.document ) ||
				left.reference.localeCompare( right.reference )
		);
		return {
			id: url,
			sourceUrl: url,
			outcome,
			retrieval,
			portable,
			...( included && path ? { path, portableAssetId: path } : {} ),
			...( outcome === 'failed' ? { error: failure } : {} ),
			referenceCount: indexed.count,
			referencesTruncated: indexed.count > MAX_ASSET_EVIDENCE_REFERENCES,
			references: locations,
		};
	} );
	return {
		assetCount: references.assetCount,
		assetCountExact: references.assetCountExact,
		totalReferenceCount: references.totalReferenceCount,
		assetsTruncated: !references.assetCountExact,
		assets: records,
	};
}

function removeDanglingMediaSource(
	html: string,
	reference: string,
	resolvedUrl: string,
	rejectedKeys?: Set< string >
): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	// A video/source/audio `src` that could not be localized must keep naming
	// a real, fetchable location rather than an empty attribute: an emptied
	// `src` is unrecoverable downstream (a WordPress import, say, drops the
	// element entirely), while the resolved source URL at least survives as
	// external evidence with a matching diagnostic already recorded by the
	// caller. `poster` (an ordinary image, handled below) keeps the existing
	// stub behavior — losing a preview thumbnail is not the same class of
	// loss as losing the media itself.
	let strippedNonImageSrc = false;
	const withoutSources = html.replace( /<(img|source|video|audio)\b[^>]*>/gi, ( tag ) => {
		const element = /^<(\w+)/.exec( tag )?.[ 1 ].toLowerCase();
		const src = /\bsrc\s*=\s*(["'])([\s\S]*?)\1/i.exec( tag )?.[ 2 ].replace( /&amp;/g, '&' );
		if ( src !== normalizedReference ) return tag;
		if ( element === 'img' ) {
			return tag.replace( /\s+src\s*=\s*(["'])([\s\S]*?)\1/i, ` src="${ TRANSPARENT_IMAGE_DATA_URL }"` );
		}
		strippedNonImageSrc = true;
		return tag.replace( /\s+src\s*=\s*(["'])([\s\S]*?)\1/i, ` src="${ resolvedUrl }"` );
	} );
	// Once a non-image `src` has been repointed at its resolved URL, the
	// broad substring pass below must not run: `resolvedUrl` commonly
	// contains `reference` as a trailing substring (a relative reference
	// resolved against its document), and re-scanning would immediately
	// mangle the replacement it just made.
	if ( strippedNonImageSrc ) return withoutSources;
	return replaceAll(
		withoutSources,
		new Map( [
			[ reference, TRANSPARENT_IMAGE_DATA_URL ],
			[ normalizedReference, TRANSPARENT_IMAGE_DATA_URL ],
		] ),
		rejectedKeys
	);
}

function replaceDanglingCssUrl(
	html: string,
	reference: string,
	rejectedKeys?: Set< string >
): string {
	// An empty data: URL is a valid, zero-byte resource, so the browser reports a
	// clean load for an asset the capture never got. about:blank cannot be fetched
	// as a subresource, keeping the loss visible instead of silently successful.
	return replaceAll( html, new Map( [ [ reference, 'about:blank' ] ] ), rejectedKeys );
}

function removeDanglingResourceReference( html: string, reference: string ): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	const $ = cheerio.load( html );
	$( 'link' ).each( ( _, element ) => {
		const link = $( element );
		const relations = ( link.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
		const href = ( link.attr( 'href' ) ?? '' ).replace( /&amp;/g, '&' );
		if (
			href === normalizedReference &&
			( relations.includes( 'preload' ) ||
				relations.includes( 'stylesheet' ) ||
				relations.some( ( value ) => /(?:^|-)icon$/.test( value ) ) )
		) {
			link.remove();
		}
	} );
	$( 'script' ).each( ( _, element ) => {
		const script = $( element );
		const src = ( script.attr( 'src' ) ?? '' ).replace( /&amp;/g, '&' );
		if ( src === normalizedReference ) script.remove();
	} );
	return $.html();
}

function safeCapturedPageHtml( html: string ): { html: string; jsonLd: string[] } {
	const $ = cheerio.load( html );
	const jsonLd: string[] = [];
	let jsonLdScriptCount = 0;
	let jsonLdSourceBytes = 0;
	// Preserve rendered structure and author CSS, but never ship executable provider runtime.
	$( 'script,noscript,object,embed,base' ).each( ( _index, element ) => {
		const node = $( element );
		if ( element.name === 'script' && /^application\/ld\+json(?:\s*;|\s*$)/i.test( node.attr( 'type' ) ?? '' ) ) {
			const source = node.text();
			const bytes = Buffer.byteLength( source );
			if (
				jsonLdScriptCount < MAX_JSON_LD_SCRIPTS &&
				bytes <= MAX_JSON_LD_SCRIPT_BYTES &&
				jsonLdSourceBytes + bytes <= MAX_JSON_LD_TOTAL_BYTES
			) {
				jsonLdSourceBytes += bytes;
				try {
					const value: unknown = JSON.parse( source );
					if ( value !== null && typeof value === 'object' ) {
						// Keep JSON-LD inert even when a source string contains an escaped end tag.
						jsonLd.push( JSON.stringify( value ).replace( /<\/script(?=[\t\n\f\r />])/gi, '<\\/script' ) );
					}
				} catch {
					// Invalid JSON-LD is discarded with the source script.
				}
			}
			jsonLdScriptCount++;
		}
		node.remove();
	} );
	if ( jsonLd.length > 0 ) {
		$( 'head' ).append(
			jsonLd.map( ( value ) => `<script type="application/ld+json">${ value }</script>` ).join( '' )
		);
	}
	$( 'iframe' ).each( ( _index, element ) => {
		const node = $( element );
		const source = node.attr( VISUAL_IFRAME_EVIDENCE_ATTRIBUTES.src ) ?? '';
		const width = node.attr( VISUAL_IFRAME_EVIDENCE_ATTRIBUTES.width ) ?? '';
		const height = node.attr( VISUAL_IFRAME_EVIDENCE_ATTRIBUTES.height ) ?? '';
		let safeSource = false;
		try {
			const url = new URL( source );
			safeSource = url.protocol === 'https:' && url.hostname !== '';
		} catch {
			// Unattested and malformed iframe sources are not portable.
		}
		if ( ! safeSource || ! /^[1-9]\d*$/.test( width ) || ! /^[1-9]\d*$/.test( height ) ) {
			node.remove();
			return;
		}

		for ( const attribute of Object.keys( 'attribs' in element ? element.attribs : {} ) ) {
			if ( ! VISUAL_IFRAME_ATTRIBUTES.has( attribute.toLowerCase() ) ) {
				node.removeAttr( attribute );
			}
		}
		node.attr( 'src', source );
		node.attr( 'width', width );
		node.attr( 'height', height );
		node.empty();
	} );
	$( 'meta[http-equiv]' ).each( ( _index, element ) => {
		if ( ( $( element ).attr( 'http-equiv' ) ?? '' ).toLowerCase() === 'refresh' ) {
			$( element ).remove();
		}
	} );
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		for ( const [ attribute, rawValue ] of Object.entries(
			'attribs' in element ? element.attribs : {}
		) ) {
			const value = [ ...rawValue ]
				.filter( ( character ) => character.charCodeAt( 0 ) > 0x20 )
				.join( '' )
				.toLowerCase();
			if (
				/^on/i.test( attribute ) ||
				attribute.toLowerCase() === 'srcdoc' ||
				[ 'action', 'formaction' ].includes( attribute.toLowerCase() ) ||
				( [ 'href', 'src', 'xlink:href' ].includes( attribute.toLowerCase() ) &&
					/^(?:javascript|vbscript|data:text\/html)/.test( value ) ) ||
				( attribute.toLowerCase() === 'style' &&
					/(?:expression\s*\(|-moz-binding|url\s*\(\s*["']?\s*(?:javascript|vbscript|data:text\/html))/i.test(
						rawValue
					) )
			) {
				node.removeAttr( attribute );
			}
		}
	} );
	$( 'link' ).each( ( _index, element ) => {
		const node = $( element );
		const rel = ( node.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
		const as = ( node.attr( 'as' ) ?? '' ).toLowerCase();
		if (
			rel.includes( 'modulepreload' ) ||
			( rel.includes( 'preload' ) && [ 'script', 'fetch' ].includes( as ) )
		)
			node.remove();
	} );
	return { html: normalizedDeclarativeFormEmbeds( $.html() ), jsonLd };
}

function appendJsonLd( html: string, jsonLd: string[] ): string {
	if ( jsonLd.length === 0 ) return html;
	const $ = cheerio.load( html );
	$( 'head' ).append(
		jsonLd.map( ( value ) => `<script type="application/ld+json">${ value }</script>` ).join( '' )
	);
	return $.html();
}

/**
 * Same-page links in an exported route whose target is missing or ambiguous.
 *
 * The copy has no runtime left to resolve a fragment by scrolling, so a link
 * without exactly one target is a defect. Reported per route rather than
 * thrown, so one broken anchor does not discard an otherwise good capture.
 *
 * Two sources feed this, checked in order so an adapter's own verdict always
 * wins over the generic re-check of the same anchor:
 *
 *  1. `a[data-dla-anchor-fragment]` — anchors a platform's `prepare()` hook
 *     already resolved against its own click runtime (see AGENTS.md — Wix
 *     same-page anchors), carrying an optional `data-dla-anchor-unresolved`
 *     reason straight from that runtime.
 *  2. Every other `a[href="#fragment"]` (or `.../path#fragment` resolving to
 *     THIS document) — ordinary authored same-page links that never went
 *     through adapter resolution at all. A page whose deferred content never
 *     rendered before the snapshot leaves exactly this behind: a nav link to
 *     `#releases` with no `id="releases"` anywhere in the captured document.
 *     Checking every route (not a sample) costs nothing — it is pure
 *     `cheerio`, no browser — so this class of truncation surfaces as a
 *     diagnostic instead of a clean receipt.
 */
function unresolvedCapturedAnchors(
	html: string,
	sourceUrl: string
): Array< { sourceUrl: string; fragment: string; targetCount: number; reason: string } > {
	const $ = cheerio.load( html );
	const diagnostics = new Map< string, { targetCount: number; reason: string } >();
	const record = ( fragment: string, runtimeReason?: string ) => {
		if ( ! fragment || diagnostics.has( fragment ) ) return;
		const targetCount = $( '[id],a[name]' ).filter(
			( _targetIndex, target ) =>
				$( target ).attr( 'id' ) === fragment || $( target ).attr( 'name' ) === fragment
		).length;
		if ( targetCount !== 1 || runtimeReason ) {
			diagnostics.set( fragment, {
				targetCount,
				reason:
					runtimeReason ??
					( targetCount === 0
						? 'captured fragment target is missing'
						: 'captured fragment target is ambiguous' ),
			} );
		}
	};

	$( 'a[data-dla-anchor-fragment][href]' ).each( ( _index, element ) => {
		const link = $( element );
		const href = link.attr( 'href' );
		if ( ! href ) return;
		let fragment: string;
		try {
			fragment = decodeURIComponent( new URL( href, sourceUrl ).hash.slice( 1 ) );
		} catch {
			return;
		}
		record( fragment, link.attr( 'data-dla-anchor-unresolved' ) );
	} );

	let documentUrl: URL | undefined;
	try {
		documentUrl = new URL( sourceUrl );
	} catch {
		documentUrl = undefined;
	}
	$( 'a[href]' ).each( ( _index, element ) => {
		const link = $( element );
		if ( link.attr( 'data-dla-anchor-fragment' ) !== undefined ) return; // handled above
		const href = ( link.attr( 'href' ) ?? '' ).trim();
		if ( ! href || href === '#' || ! documentUrl ) return;
		let resolved: URL;
		try {
			resolved = new URL( href, sourceUrl );
		} catch {
			return;
		}
		if ( ! resolved.hash ) return;
		// Same-document only: a fragment link to a DIFFERENT page resolves against
		// that page's own document, not this one — `checkSelfConsistency` covers
		// that cross-route case once every route has been written.
		if ( resolved.origin !== documentUrl.origin || resolved.pathname !== documentUrl.pathname ) return;
		let fragment: string;
		try {
			fragment = decodeURIComponent( resolved.hash.slice( 1 ) );
		} catch {
			return;
		}
		record( fragment );
	} );

	return [ ...diagnostics ].map( ( [ fragment, diagnostic ] ) => ( {
		sourceUrl,
		fragment,
		...diagnostic,
	} ) );
}

const UNCAPTURED_ROUTE_REASON = 'target route was not captured';
const SKIP_UNCAPTURED_PATHS = /^\/(cart|account|login|signup|checkout|search|api|admin|favicon)/i;
const UNCAPTURED_ASSET_PATH =
	/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json)$/i;

/**
 * Same-origin page links in captured HTML whose target was never captured.
 *
 * Checked against the pre-rewrite document so hrefs still resolve on the
 * source origin. No extra network: the route set is whatever export already
 * retained on disk.
 */
function uncapturedRouteAnchors(
	html: string,
	sourceUrl: string,
	capturedRoutes: Set< string >,
	absentRoutes: Set< string >
): Array< { sourceUrl: string; url: string; reason: string } > {
	let documentUrl: URL;
	try {
		documentUrl = new URL( sourceUrl );
	} catch {
		return [];
	}
	const $ = cheerio.load( html );
	const missing = new Map< string, string >();
	$( 'a[href],area[href]' ).each( ( _index, element ) => {
		const href = ( $( element ).attr( 'href' ) ?? '' ).trim();
		if ( ! href || href === '#' ) return;
		let resolved: URL;
		try {
			resolved = new URL( href, sourceUrl );
		} catch {
			return;
		}
		if ( resolved.protocol !== 'http:' && resolved.protocol !== 'https:' ) return;
		if ( resolved.origin !== documentUrl.origin ) return;
		if ( UNCAPTURED_ASSET_PATH.test( resolved.pathname ) || isAudioLink( href, sourceUrl ) ) return;
		if ( SKIP_UNCAPTURED_PATHS.test( resolved.pathname ) ) return;
		let key: string;
		try {
			key = normalizedUrl( resolved.href );
		} catch {
			return;
		}
		if ( capturedRoutes.has( key ) || missing.has( key ) ) return;
		missing.set( key, key );
	} );
	return [ ...missing.values() ].map( ( url ) => ( {
		sourceUrl,
		url,
		reason: absentRoutes.has( url ) ? 'target route is absent at source' : UNCAPTURED_ROUTE_REASON,
	} ) );
}

/**
 * Group screenshot-stage failures (goto timeouts, nested-document rejections,
 * etc.) by URL so a route that never produced HTML can report every viewport
 * failure that led there, instead of the receipt just losing the route.
 */
function groupFailureReasonsByUrl(
	failures: Array< { url: unknown; error: unknown } >
): Map< string, string[] > {
	const byUrl = new Map< string, string[] >();
	for ( const failure of failures ) {
		if ( typeof failure.url !== 'string' ) continue;
		const record = failure as Record< string, unknown >;
		const viewport = typeof record.viewport === 'string' ? record.viewport : 'unknown';
		const stage = typeof record.stage === 'string' ? record.stage : 'unknown';
		const error =
			typeof failure.error === 'string'
				? failure.error
				: failure.error === undefined
					? 'unknown error'
					: JSON.stringify( failure.error );
		const list = byUrl.get( failure.url ) ?? [];
		list.push( `${ viewport }/${ stage }: ${ error.split( '\n' )[ 0 ] }` );
		byUrl.set( failure.url, list );
	}
	return byUrl;
}

export function exportWebsiteCapture( options: ExportCaptureOptions ): string {
	const outputDir = resolve( options.outputDir );
	const portableMediaTotalBytesLimit = Math.max(
		0,
		Math.floor( options.limits?.portableMediaTotalBytes ?? MAX_PORTABLE_MEDIA_TOTAL_BYTES )
	);
	/** Detected switch widths, one per route, for the source profile. */
	const switchWidths: number[] = [];
	/** Per-route learning outcomes, aggregated into the source profile. */
	const fluidReports: Array< NonNullable< ManifestEntryFluid > > = [];
	const screenshotManifestPath = join( outputDir, 'screenshots', 'manifest.json' );
	if ( ! existsSync( screenshotManifestPath ) ) {
		throw new Error( `Screenshot manifest not found: ${ screenshotManifestPath }` );
	}

	const capture = JSON.parse(
		readFileSync( screenshotManifestPath, 'utf8' )
	) as ScreenshotManifest;
	if ( capture.version !== 1 || ! capture.entries || typeof capture.entries !== 'object' ) {
		throw new Error( `Invalid screenshot manifest: ${ screenshotManifestPath }` );
	}

	const websiteDir = join( outputDir, 'website' );
	const stagedHtmlDir = join( outputDir, '.capture-export-html' );
	rmSync( websiteDir, { recursive: true, force: true } );
	rmSync( stagedHtmlDir, { recursive: true, force: true } );
	mkdirSync( websiteDir, { recursive: true } );
	mkdirSync( stagedHtmlDir, { recursive: true } );

	const capturedEntries: CaptureEntry[] = [];
	const interactionPages: InteractionStatesReport[] = [];
	const scrollStatesPages: ScrollStatesReport[] = [];
	const excludedRoutes: string[] = [];
	// A route that was discovered and attempted must never disappear from the
	// receipt without a reason. Every screenshot-stage failure (goto timeouts,
	// nested-document rejections, etc.) is grouped by URL here so that a route
	// which never produced HTML gets its own named diagnostic below, extending
	// the same {code,url,reason} shape sitemap discovery already reports
	// rejected leaves through, rather than a parallel reporting mechanism.
	const routeFailureReasons = groupFailureReasonsByUrl( options.failures );
	const routeCaptureDiagnostics: Array< { code: string; url: string; reason: string } > = [];
	for ( const [ url, entry ] of Object.entries( capture.entries ) ) {
		if ( ! routeMatchesSourceOrigin( url, options.sourceUrl ) ) {
			excludedRoutes.push( url );
			continue;
		}
		if ( ! entry.html ) {
			const reason = routeFailureReasons.get( url )?.join( '; ' )
				?? 'capture completed without producing page HTML';
			if ( failuresAreAbsentDocument( options.failures, url ) ) {
				excludedRoutes.push( url );
				routeCaptureDiagnostics.push( {
					code: 'route_not_found',
					url,
					reason,
				} );
			} else {
				routeCaptureDiagnostics.push( {
					code: 'route_capture_failed',
					url,
					reason,
				} );
			}
			continue;
		}
		const capturedHtmlPath = resolve( outputDir, entry.html );
		if ( ! pathWithin( outputDir, capturedHtmlPath ) || ! existsSync( capturedHtmlPath ) ) {
			routeCaptureDiagnostics.push( {
				code: 'route_capture_failed',
				url,
				reason: `captured HTML file is missing or outside the output directory: ${ entry.html }`,
			} );
			continue;
		}
		const rawDesktopHtml = readFileSync( capturedHtmlPath, 'utf8' );
		// A client-routed SPA answers every route with HTTP 200 and renders its
		// own not-found screen in JavaScript, so the HTTP-status check above
		// (failuresAreAbsentDocument) never sees it: the entry has HTML, capture
		// succeeded, there is no failure to inspect. Never applied to the source
		// URL itself -- it is known good regardless of what it renders.
		if (
			! isSourceCaptureUrl( url, options.sourceUrl ) &&
			isAbsentDocumentRender( rawDesktopHtml )
		) {
			excludedRoutes.push( url );
			routeCaptureDiagnostics.push( {
				code: 'route_not_found',
				url,
				reason:
					'rendered document is the client-routed not-found screen: a heading of just "404"/"410" on an otherwise thin page',
			} );
			continue;
		}
		const mobileHtmlPath = resolve( outputDir, entry.html.replace( /^html[\\/]/, 'html-mobile/' ) );
		const rawMobileHtml =
			pathWithin( outputDir, mobileHtmlPath ) && existsSync( mobileHtmlPath )
				? readFileSync( mobileHtmlPath, 'utf8' )
				: undefined;
		const detectedFloor =
			typeof entry.fluid?.canvasFloor === 'number' && entry.fluid.canvasFloor > 0
				? Math.round( entry.fluid.canvasFloor )
				: undefined;
		if ( detectedFloor ) switchWidths.push( detectedFloor );
		if ( entry.fluid ) fluidReports.push( entry.fluid );
		const responsiveVariants = responsiveVariantEvidence( rawDesktopHtml, rawMobileHtml );
		const desktopHtml = normalizedDeclarativeFormEmbeds( renderedHtml( rawDesktopHtml ) );
		const mobileHtml =
			rawMobileHtml === undefined
				? undefined
				: normalizedDeclarativeFormEmbeds( renderedHtml( rawMobileHtml ) );
		const capturedHtml =
			rawMobileHtml === undefined
				? desktopHtml
				: responsiveVariants?.outcome === 'dual-structural'
					? responsiveHtml( desktopHtml, mobileHtml as string, detectedFloor )
					: normalizedDeclarativeFormEmbeds(
							renderedHtml( responsiveHtml( rawDesktopHtml, rawMobileHtml, detectedFloor ) )
					  );
		// safeCapturedPageHtml removes <base>; record its stylesheet semantics first.
		const styleHoistContext = capturedStyleHoistContext( capturedHtml );
		const sanitized = safeCapturedPageHtml( capturedHtml );
		const html = sanitized.html;
		const stagedHtmlPath = join( stagedHtmlDir, `${ capturedEntries.length }.html` );
		writeFileSync( stagedHtmlPath, html );
		capturedEntries.push( {
			slug: entry.slug ?? basename( entry.html, '.html' ),
			url,
			htmlPath: stagedHtmlPath,
			evidenceDocuments: [
				{ state: 'desktop', html: desktopHtml },
				...( mobileHtml === undefined ? [] : [ { state: 'mobile' as const, html: mobileHtml } ] ),
			],
			hasMobileDocument: responsiveVariants?.outcome === 'dual-structural',
			responsiveVariants,
			sections: entry.sections,
			canonicalUrl: canonicalMetadataUrl(
				entry.metadata?.openGraph?.[ 'og:url' ] ?? openGraphUrl( html ),
				url
			),
			jsonLd: sanitized.jsonLd,
			interactions: entry.interactions,
			scrollStates: entry.scrollStates,
			styleHoistContext,
		} );
		if (
			entry.interactions?.schema === INTERACTION_STATES_SCHEMA ||
			entry.interactions?.schema === LEGACY_INTERACTION_STATES_SCHEMA
		) {
			interactionPages.push( entry.interactions );
		}
		if ( entry.scrollStates?.schema === SCROLL_STATES_SCHEMA && entry.scrollStates.toggles.length > 0 ) {
			scrollStatesPages.push( entry.scrollStates );
		}
	}

	const normalizedSourceUrl = normalizedUrl( options.sourceUrl );
	const exactEntrypointCandidates = capturedEntries.filter(
		( { url } ) => normalizedUrl( url ) === normalizedSourceUrl
	);
	const entrypointCandidates =
		exactEntrypointCandidates.length > 0
			? exactEntrypointCandidates
			: capturedEntries.filter(
					( { canonicalUrl } ) =>
						canonicalUrl !== undefined && normalizedUrl( canonicalUrl ) === normalizedSourceUrl
			  );
	if ( entrypointCandidates.length !== 1 ) {
		throw new Error(
			`Capture does not identify one rendered homepage for the source URL: ${ options.sourceUrl }`
		);
	}
	const entrypointUrl = entrypointCandidates[ 0 ].url;
	const originRootCaptured = capturedOriginRoot(
		capturedEntries.map( ( entry ) => entry.url ),
		new URL( options.sourceUrl ).origin
	);
	const naturalRoutePath = ( url: string ) =>
		routeOutputPath( url, options.sourceUrl, entrypointUrl, originRootCaptured ).replace(
			/\\/g,
			'/'
		);
	const allocatedPaths = new Map< string, string >();
	const reservedPaths = new Set( capturedEntries.map( ( entry ) => naturalRoutePath( entry.url ) ) );
	// Keyed by normalized URL, not the raw captured URL: an entry URL carrying
	// a query string or fragment (a tokenized link, tracking parameter, etc.)
	// still names the site root, and its captured directory route must be
	// found by what it resolves to rather than by exact string equality.
	const entriesByNormalizedUrl = new Map(
		capturedEntries.map( ( entry ) => [ normalizedUrl( entry.url ), entry ] )
	);
	// Two captured URLs naming the same document are content-duplicates when
	// they render identically; recorded here so the dedupe pass below treats
	// them the same way a declared canonical route already would.
	const contentAliasPartners = new Map< string, string >();
	// A directory and its default document can be distinct pages. Keep both
	// unless the existing canonical contract proves an alias. Reserve every
	// natural path first so a generated filename never steals another route.
	for ( const entry of capturedEntries ) {
		const url = new URL( entry.url );
		if ( url.search || url.hash || ! url.pathname.endsWith( '/index.html' ) ) continue;
		const directoryUrl = new URL( './', url ).href;
		const directory = entriesByNormalizedUrl.get( normalizedUrl( directoryUrl ) );
		const path = naturalRoutePath( entry.url );
		if ( ! directory || naturalRoutePath( directoryUrl ) !== path ) continue;
		if ( declaresCanonicalRoute( entry, directory ) || declaresCanonicalRoute( directory, entry ) ) continue;
		if ( readFileSync( entry.htmlPath, 'utf8' ) === readFileSync( directory.htmlPath, 'utf8' ) ) {
			contentAliasPartners.set( entry.url, directory.url );
			contentAliasPartners.set( directory.url, entry.url );
			continue;
		}
		const displaced = entry.url === entrypointUrl ? directory : entry;
		if ( [ ...reservedPaths ].some( ( reserved ) => path.startsWith( `${ reserved }/` ) ) )
			throw new Error( `Captured route needs a directory already claimed by a file: ${ path }` );
		let suffix = 2;
		let allocated: string;
		do {
			allocated = `${ path.slice( 0, -'.html'.length ) }-${ suffix++ }.html`;
		} while ( [ ...reservedPaths ].some( ( reserved ) =>
			reserved === allocated || reserved.startsWith( `${ allocated }/` )
		) );
		reservedPaths.add( allocated );
		allocatedPaths.set( displaced.url, allocated );
	}
	const routePathOf = ( url: string ) => allocatedPaths.get( url ) ?? naturalRoutePath( url );

	const retainedEntries: CaptureEntry[] = [];
	const duplicateRoutes: Array< { url: string; canonicalUrl: string; path: string } > = [];
	const canonicalRouteAliases = new Map< string, string >();
	const claimedRoutes = new Map< string, CaptureEntry >();
	for ( const entry of [
		...capturedEntries.filter( ( { url } ) => url === entrypointUrl ),
		...capturedEntries.filter( ( { url } ) => url !== entrypointUrl ),
	] ) {
		const routePath = routePathOf( entry.url );
		const claimed = claimedRoutes.get( routePath );
		if ( ! claimed ) {
			claimedRoutes.set( routePath, entry );
			retainedEntries.push( entry );
			continue;
		}
		if (
			! declaresCanonicalRoute( entry, claimed ) &&
			contentAliasPartners.get( entry.url ) !== claimed.url
		) {
			throw new Error( `Captured routes resolve to the same website path: ${ routePath }` );
		}
		if ( entry.jsonLd.length > 0 ) {
			writeFileSync(
				claimed.htmlPath,
				appendJsonLd( readFileSync( claimed.htmlPath, 'utf8' ), entry.jsonLd )
			);
		}
		duplicateRoutes.push( {
			url: entry.url,
			canonicalUrl: claimed.url,
			path: `website/${ routePath }`,
		} );
		canonicalRouteAliases.set( normalizedUrl( entry.url ), routePath );
	}
	const desktopSections = SectionSpecsStore.load( outputDir );
	const mobileSections = SectionSpecsStore.loadMobile( outputDir );
	const semanticPages: SemanticEvidencePage[] = retainedEntries.flatMap( ( entry ) => {
		const desktop = desktopSections.get( entry.url );
		if ( ! isUsableSectionEvidence( desktop ) ) return [];
		const mobile = mobileSections.get( entry.url );
		return [ {
			path: `website/${ routePathOf( entry.url ) }`,
			url: entry.url,
			viewports: {
				desktop: semanticSectionEvidence( desktop ),
				...( isUsableSectionEvidence( mobile )
					? { mobile: semanticSectionEvidence( mobile ) }
					: {} ),
			},
		} ];
	} );
	const semanticEvidence =
		semanticPages.length > 0 ? semanticEvidenceArtifacts( semanticPages ) : undefined;
	const mediaReplacements = new Map< string, string >();
	const unresolvedMedia: Array< { url: string; error: string } > = [];
	const assets: Array< { sourceUrl: string; path: string } > = [];
	const mediaStubs = MediaStubStore.load( outputDir );
	const resourceManifest = capturedResources( outputDir );
	const assetReferenceLocations = assetReferences(
		retainedEntries,
		routePathOf,
		resourceManifest,
		outputDir
	);
	const renderedMediaReferences = capturedMediaReferences( retainedEntries );
	const mediaFamilies = new Map< string, MediaCandidate[] >();
	const retainedMediaFamilies = retainedMediaReferencesByFamily( retainedEntries );
	const failedMedia: Array< { sourceUrl: string; error: string; references: string[] } > = [];
	const capturedPages = new Set(
		[ options.sourceUrl, ...retainedEntries.map( ( entry ) => entry.url ) ].flatMap( ( url ) => {
			try {
				return [ normalizedUrl( url ) ];
			} catch {
				return [];
			}
		} )
	);
	for ( const [ sourceUrl, stub ] of mediaStubs.list() ) {
		try {
			if ( capturedPages.has( normalizedUrl( sourceUrl ) ) ) continue;
		} catch {
			// Invalid media URLs still flow through mediaReferences().
		}
		const references = mediaReferences( sourceUrl, options.sourceUrl );
		const family = mediaFamily( sourceUrl );
		const exactReferences = references.filter( ( reference ) =>
			retainedEntries.some( ( entry ) =>
				containsMediaReference( readFileSync( entry.htmlPath, 'utf8' ), reference )
			)
		);
		const isReferenced = retainedMediaFamilies.has( family ) || exactReferences.length > 0;
		if ( stub.status === 'error' && isReferenced ) {
			failedMedia.push( { sourceUrl, error: stub.error ?? 'media download failed', references } );
			continue;
		}
		if (
			stub.status !== 'success' ||
			! stub.localPath ||
			! existsSync( stub.localPath ) ||
			! isReferenced
		)
			continue;
		const candidate: MediaCandidate = {
			sourceUrl,
			localPath: stub.localPath,
			references: [
				...new Set( [ ...references, ...( renderedMediaReferences.get( family ) ?? [] ) ] ),
			],
			exactReferences,
			bytes: statSync( stub.localPath ).size,
			dimension: mediaDimension( sourceUrl ),
		};
		mediaFamilies.set( family, [ ...( mediaFamilies.get( family ) ?? [] ), candidate ] );
	}
	const portableMediaCandidates = [ ...mediaFamilies.values() ]
		.map( ( candidates ) => ( { candidates, selected: selectMediaCandidates( candidates ) } ) )
		.sort( ( left, right ) => {
			const leftEntrypoint = left.candidates.some( ( candidate ) =>
				candidate.references.some( ( reference ) =>
					containsMediaReference(
						readFileSync( entrypointCandidates[ 0 ].htmlPath, 'utf8' ),
						reference
					)
				)
			);
			const rightEntrypoint = right.candidates.some( ( candidate ) =>
				candidate.references.some( ( reference ) =>
					containsMediaReference(
						readFileSync( entrypointCandidates[ 0 ].htmlPath, 'utf8' ),
						reference
					)
				)
			);
			return (
				Number( rightEntrypoint ) - Number( leftEntrypoint ) ||
				( left.selected[ 0 ]?.bytes ?? 0 ) - ( right.selected[ 0 ]?.bytes ?? 0 ) ||
				( left.selected[ 0 ]?.sourceUrl ?? '' ).localeCompare(
					right.selected[ 0 ]?.sourceUrl ?? ''
				)
			);
		} );
	const portableMediaBudget = portableMediaTotalBytesLimit;
	const selectedPortableMedia = new Set< MediaCandidate >();
	const portableMediaHashes = new Set< string >();
	let portableMediaBytes = 0;
	for ( const family of portableMediaCandidates ) {
		for ( const selected of family.selected ) {
			const contentHash = fileHash( selected.localPath );
			const needsFile = ! portableMediaHashes.has( contentHash );
			if ( ! needsFile || portableMediaBytes + selected.bytes <= portableMediaBudget ) {
				selectedPortableMedia.add( selected );
				if ( needsFile ) {
					portableMediaHashes.add( contentHash );
					portableMediaBytes += selected.bytes;
				}
			}
		}
	}
	let retainedExternalMediaCount = 0;
	const localizedMediaFamilies = new Set< string >();
	const assetPathsByHash = new Map< string, string >();
	const assetHashesByPath = new Map< string, string >();
	const portablePathsBySource = new Map< string, string >();
	for ( const candidates of mediaFamilies.values() ) {
		const family = mediaFamily( candidates[ 0 ].sourceUrl );
		const eligible = selectMediaCandidates( candidates );
		if ( eligible.length === 0 ) {
			for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
				mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, candidate.sourceUrl );
				}
				unresolvedMedia.push( {
					url: candidate.sourceUrl,
					error: 'removed because media exceeds portable size or dimension limits',
				} );
				retainedExternalMediaCount++;
			}
			continue;
		}
		const selected = eligible.filter( ( candidate ) => selectedPortableMedia.has( candidate ) );
		if ( selected.length === 0 ) {
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
				}
			}
			unresolvedMedia.push( {
				url: eligible[ 0 ].sourceUrl,
				error: 'removed because the aggregate portable media limit was reached',
			} );
			retainedExternalMediaCount++;
			continue;
		}
		localizedMediaFamilies.add( family );
		let fallbackAssetPath = '';
		for ( const candidate of selected ) {
			const contentHash = fileHash( candidate.localPath );
			let assetPath = assetPathsByHash.get( contentHash );
			if ( assetPath === undefined ) {
				assetPath = uniqueAssetPath(
					join( 'media', portableMediaBasename( candidate ) ),
					contentHash,
					assetHashesByPath
				);
				const destination = join( websiteDir, assetPath );
				mkdirSync( dirname( destination ), { recursive: true } );
				copyFileSync( candidate.localPath, destination );
				assetPathsByHash.set( contentHash, assetPath );
				assetHashesByPath.set( assetPath, contentHash );
				assets.push( {
					sourceUrl: candidate.sourceUrl,
					path: join( 'website', assetPath ).replace( /\\/g, '/' ),
				} );
			}
			portablePathsBySource.set(
				candidate.sourceUrl,
				`website/${ assetPath.replace( /\\/g, '/' ) }`
			);
			fallbackAssetPath ||= assetPath;
			for ( const reference of candidate.exactReferences ) {
				mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
			}
		}
		for ( const reference of retainedMediaFamilies.get( family ) ?? [] ) {
			if ( ! mediaReplacements.has( reference ) )
				mediaReplacements.set( reference, `/${ fallbackAssetPath.replace( /\\/g, '/' ) }` );
		}
	}
	const portableMedia = {
		selected_count: assets.length,
		selected_bytes: portableMediaBytes,
		retained_external_count: retainedExternalMediaCount,
		max_bytes: portableMediaBudget,
		reserved_bytes: 0,
	};
	for ( const { sourceUrl, error, references } of failedMedia ) {
		const family = mediaFamily( sourceUrl );
		if ( localizedMediaFamilies.has( family ) ) continue;
		for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
			mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
		for ( const reference of references )
			mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
		unresolvedMedia.push( { url: sourceUrl, error } );
	}

	const unresolvedDependencies: Array< { url: string; sourceUrl: string; error: string } > = [];
	const rejectedReplacementKeys = new Set< string >();
	const copiedResources = new Set< string >();
	const copyingResources = new Set< string >();
	const resourceReplacements = new Map< string, string >();
	const promoteCapturedMediaReplacement = ( dependencyUrl: string, documentUrl: string ) => {
		const portablePath = resourceReplacements.get( dependencyUrl );
		if ( ! portablePath ) return;
		for ( const [ reference, replacement ] of mediaReplacements ) {
			if ( replacement !== TRANSPARENT_IMAGE_DATA_URL ) continue;
			try {
				if ( new URL( reference.replace( /&amp;/g, '&' ), documentUrl ).href === dependencyUrl )
					mediaReplacements.set( reference, portablePath );
			} catch {
				// Malformed references cannot alias a captured resource URL.
			}
		}
	};
	const copyResource = ( dependency: PortableDependency, sourceUrl: string ): boolean => {
		const resource = resourceManifest.resources[ dependency.url ];
		if ( ! resource ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'referenced same-origin dependency was not captured',
			} );
			return false;
		}
		const source = resolve( outputDir, resource.path );
		if ( ! pathWithin( outputDir, source ) || ! existsSync( source ) ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'captured dependency file is unavailable',
			} );
			return false;
		}
		const requestedPath = portableResourcePath( resource.path, resource.contentType );
		if ( ! requestedPath ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: `captured dependency has no portable extension for ${
					resource.contentType || 'unknown content type'
				}`,
			} );
			return false;
		}
		const isText = /^(?:application\/json|text\/)/i.test( resource.contentType );
		const contentHash = isText ? '' : fileHash( source );
		const relativePath = isText
			? requestedPath
			: assetPathsByHash.get( contentHash ) ??
			  uniqueAssetPath( requestedPath, contentHash, assetHashesByPath );
		const destination = resolve( websiteDir, relativePath );
		const portablePath = `/${ relativePath.replace( /\\/g, '/' ) }`;
		const alreadyCopied =
			( ! isText && assetPathsByHash.has( contentHash ) ) ||
			copiedResources.has( resource.path ) ||
			copyingResources.has( resource.path );
		if ( ! pathWithin( websiteDir, destination ) ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'captured dependency file is unavailable',
			} );
			return false;
		}
		resourceReplacements.set( dependency.reference, portablePath );
		resourceReplacements.set( dependency.url, portablePath );
		portablePathsBySource.set( dependency.url, `website/${ relativePath.replace( /\\/g, '/' ) }` );
		if ( alreadyCopied ) return true;
		mkdirSync( dirname( destination ), { recursive: true } );
		copyingResources.add( resource.path );
		if ( isText ) {
			let content = readFileSync( source, 'utf8' );
			if ( /text\/css/i.test( resource.contentType ) ) {
				for ( const nested of dependencyReferences( content, dependency.url, true ) ) {
					const mediaReplacement =
						mediaReplacements.get( nested.reference ) ?? mediaReplacements.get( nested.url );
					if (
						mediaReplacement &&
						mediaReplacement !== TRANSPARENT_IMAGE_DATA_URL &&
						! /^(?:https?:)?\/\//i.test( mediaReplacement )
					)
						continue;
					if ( copyResource( nested, dependency.url ) ) {
						if ( mediaReplacement === TRANSPARENT_IMAGE_DATA_URL ) {
							promoteCapturedMediaReplacement( nested.url, dependency.url );
						}
					} else {
						content = replaceDanglingCssUrl( content, nested.reference, rejectedReplacementKeys );
					}
				}
			}
			content = replaceAll( content, mediaReplacements, rejectedReplacementKeys );
			writeFileSync(
				destination,
				replaceAll( content, resourceReplacements, rejectedReplacementKeys )
			);
		} else {
			copyFileSync( source, destination );
			assetPathsByHash.set( contentHash, relativePath );
			assetHashesByPath.set( relativePath, contentHash );
		}
		copyingResources.delete( resource.path );
		copiedResources.add( resource.path );
		assets.push( {
			sourceUrl: dependency.url,
			path: `website/${ relativePath.replace( /\\/g, '/' ) }`,
		} );
		return true;
	};
	for ( const entry of retainedEntries ) {
		const originalHtml = readFileSync( entry.htmlPath, 'utf8' );
		let html = originalHtml;
		for ( const dependency of dependencyReferences( html, entry.url ) ) {
			const mediaReplacement = mediaReplacements.get( dependency.reference );
			if (
				mediaReplacement &&
				mediaReplacement !== TRANSPARENT_IMAGE_DATA_URL &&
				! /^(?:https?:)?\/\//i.test( mediaReplacement )
			)
				continue;
			if ( copyResource( dependency, entry.url ) ) {
				// A browser-captured response is a faithful bounded fallback when the
				// independent media fetch failed. Let its local replacement win.
				if ( mediaReplacement === TRANSPARENT_IMAGE_DATA_URL ) {
					promoteCapturedMediaReplacement( dependency.url, entry.url );
				}
			} else {
				html =
					dependency.kind === 'media'
						? removeDanglingMediaSource(
								html,
								dependency.reference,
								dependency.url,
								rejectedReplacementKeys
						  )
						: dependency.kind === 'css'
						? replaceDanglingCssUrl( html, dependency.reference, rejectedReplacementKeys )
						: removeDanglingResourceReference( html, dependency.reference );
			}
		}
		if ( html !== originalHtml ) writeFileSync( entry.htmlPath, html );
	}
	const inlineStyles = new Map< string, Array< { entry: CaptureEntry; css: string; media: string } > >();
	const styleHoistDiagnostics = createStyleHoistDiagnosticCollector();
	for ( const entry of retainedEntries ) {
		const html = readFileSync( entry.htmlPath, 'utf8' );
		let styleIndex = 0;
		for ( const match of html.matchAll( /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi ) ) {
			const reason = styleHoistReason( entry, styleIndex++, match[ 1 ], match[ 2 ] );
			const style = portableInlineStyle( match[ 1 ], match[ 2 ] );
			if ( reason || !style ) {
				recordStyleHoistDiagnostic( styleHoistDiagnostics, {
					sourceUrl: entry.url,
					reason: reason ?? 'unsafe_attributes',
				} );
				continue;
			}
			const occurrences = inlineStyles.get( style.key ) ?? [];
			occurrences.push( {
				entry,
				css: match[ 2 ],
				media: style.media,
			} );
			inlineStyles.set( style.key, occurrences );
		}
	}
	const sharedStyles = new Map< string, { path: string; media: string } >();
	const stylesheetPaths = new Map< string, string >();
	const styleReplacements = new Map( [ ...mediaReplacements, ...resourceReplacements ] );
	for ( const [ key, occurrences ] of [ ...inlineStyles ].sort( ( left, right ) =>
		left[ 0 ].localeCompare( right[ 0 ] )
	) ) {
		if ( new Set( occurrences.map( ( occurrence ) => occurrence.entry.htmlPath ) ).size < 2 ) continue;
		const style = occurrences[ 0 ];
		// Hoisted styles leave the HTML rewrite path, so localize them before writing.
		const css = replaceAll( style.css, styleReplacements, rejectedReplacementKeys );
		const contentHash = createHash( 'sha256' ).update( css ).digest( 'hex' );
		const relativePath = stylesheetPaths.get( contentHash ) ?? `assets/css/capture-${ contentHash }.css`;
		const destination = join( websiteDir, relativePath );
		if ( ! stylesheetPaths.has( contentHash ) ) {
			mkdirSync( dirname( destination ), { recursive: true } );
			writeFileSync( destination, css );
			assets.push( {
				sourceUrl: `${ options.sourceUrl }#inline-style-${ contentHash }`,
				path: `website/${ relativePath }`,
			} );
			stylesheetPaths.set( contentHash, relativePath );
		}
		sharedStyles.set( key, { path: `/${ relativePath }`, media: style.media } );
	}
	if ( sharedStyles.size > 0 ) {
		for ( const entry of retainedEntries ) {
			const $ = cheerio.load( readFileSync( entry.htmlPath, 'utf8' ) );
			$( 'style' ).each( ( _index, element ) => {
				const attributes = 'attribs' in element ? element.attribs : {};
				const style = portableInlineStyle(
					Object.entries( attributes )
						.map( ( [ name, value ] ) => ` ${ name }="${ escapeHtmlAttr( value ?? '' ) }"` )
						.join( '' ),
					$( element ).html() ?? ''
				);
				const shared = style ? sharedStyles.get( style.key ) : undefined;
				if ( ! style || ! shared ) return;
				const link = $( '<link>' ).attr( { rel: 'stylesheet', href: shared.path } );
				if ( shared.media ) link.attr( 'media', shared.media );
				$( element ).replaceWith( link );
			} );
			writeFileSync( entry.htmlPath, $.html() );
		}
	}

	const routes: Array< { url: string; path: string } > = [];
	const portableRouteLinks = new Map< string, string >();
	for ( const entry of retainedEntries ) {
		const { url } = entry;
		const routePath = routePathOf( url );
		const portablePath = `/${ routePath }`;
		portableRouteLinks.set( normalizedUrl( url ), portablePath );
		routes.push( {
			url,
			path: `website/${ routePath }`,
			...( entry.responsiveVariants ? { responsiveVariants: entry.responsiveVariants } : {} ),
		} );
	}
	for ( const [ aliasKey, routePath ] of canonicalRouteAliases ) {
		if ( portableRouteLinks.has( aliasKey ) ) continue;
		portableRouteLinks.set( aliasKey, `/${ routePath }` );
	}
	for ( const { url, canonicalUrl } of retainedEntries ) {
		if ( ! canonicalUrl ) continue;
		const canonicalKey = normalizedUrl( canonicalUrl );
		if ( portableRouteLinks.has( canonicalKey ) ) continue;
		const routePath = routePathOf( url );
		portableRouteLinks.set( canonicalKey, `/${ routePath }` );
	}

	const portableServedPaths = new Set< string >();
	for ( const path of [
		...portableRouteLinks.values(),
		...mediaReplacements.values(),
		...resourceReplacements.values(),
		...[ ...sharedStyles.values() ].map( ( style ) => style.path ),
	] ) {
		if ( ! path.startsWith( '/' ) ) continue;
		try {
			const pathname = new URL( path, PORTABLE_LINK_BASE ).pathname;
			portableServedPaths.add( pathname );
			if ( pathname.endsWith( '/index.html' ) ) {
				portableServedPaths.add( pathname.slice( 0, -'index.html'.length ) );
				portableServedPaths.add( pathname.slice( 0, -'/index.html'.length ) || '/' );
			}
		} catch {
			// A replacement that is not a URL path serves nothing a link could name.
		}
	}

	const unresolvedAnchors: Array< {
		sourceUrl: string;
		reason: string;
		fragment?: string;
		targetCount?: number;
		url?: string;
	} > = [];
	const capturedRouteKeys = new Set( portableRouteLinks.keys() );
	const absentRoutes = new Set( routeCaptureDiagnostics
		.filter( ( diagnostic ) => diagnostic.code === 'route_not_found' )
		.map( ( diagnostic ) => diagnostic.url ) );
	const absentRouteKeys = new Set( [ ...absentRoutes ].map( normalizedUrl ) );
	for ( const entry of retainedEntries ) {
		const { url, htmlPath } = entry;
		const routePath = routePathOf( url );
		const destination = join( websiteDir, routePath );
		if ( ! pathWithin( websiteDir, destination ) ) {
			throw new Error( `Captured route escapes the website directory: ${ url }` );
		}
		mkdirSync( dirname( destination ), { recursive: true } );
		const originalHtml = readFileSync( htmlPath, 'utf8' );
		unresolvedAnchors.push( ...uncapturedRouteAnchors( originalHtml, url, capturedRouteKeys, absentRouteKeys ) );
		// Rewrite route links once, after wiring dialogs below. A portable path
		// can also name a source route that was allocated a different filename.
		const identityHtml = replaceAll(
			rewriteMediaUrls(
				originalHtml,
				omitDegenerateReplacements( mediaReplacements, rejectedReplacementKeys )
			),
			resourceReplacements,
			rejectedReplacementKeys
		);
		const normalizedHtml = rewriteCapturedRouteLinks(
			wireCapturedDialogs(
				withoutGeometryIdentities( identityHtml ),
				entry.interactions?.states ?? [],
				entry.interactions?.initialDialogs ?? []
			),
			url,
			portableRouteLinks,
			{ documentPath: `/${ routePath }`, servedPaths: portableServedPaths }
		);
		unresolvedAnchors.push( ...unresolvedCapturedAnchors( normalizedHtml, url ) );
		writeFileSync( destination, normalizedHtml );
		entry.identityHtmlPath = `${ htmlPath }.identity`;
		writeFileSync( entry.identityHtmlPath, identityHtml );
	}
	selfContainWebsite( websiteDir );

	const geometryCaptureOmissions: Record< string, number > = {};
	const geometryInputs = function* () {
		for ( const entry of [ ...retainedEntries ].sort( ( left, right ) =>
			left.url.localeCompare( right.url )
		) ) {
			const observations: GeometryCapture[ 'observations' ] = [];
			for ( const viewport of [ 'desktop', 'mobile' ] ) {
				const path = join( outputDir, 'layout-geometry', `${ entry.slug }.${ viewport }.json` );
				if ( ! existsSync( path ) ) {
					geometryCaptureOmissions[ 'capture_missing' ] =
						( geometryCaptureOmissions[ 'capture_missing' ] ?? 0 ) + 1;
					continue;
				}
				try {
					const capture = JSON.parse( readFileSync( path, 'utf8' ) ) as GeometryCapture;
					if (
						capture.schema !== 'data-liberation/layout-geometry-capture/v1' ||
						! Array.isArray( capture.observations )
					) {
						throw new Error( 'schema_invalid' );
					}
					observations.push( ...capture.observations );
					for ( const [ code, count ] of Object.entries( capture.omissions ?? {} ) )
						geometryCaptureOmissions[ code ] = ( geometryCaptureOmissions[ code ] ?? 0 ) + count;
				} catch {
					geometryCaptureOmissions[ 'capture_invalid' ] =
						( geometryCaptureOmissions[ 'capture_invalid' ] ?? 0 ) + 1;
				}
			}
			const routePath = routePathOf( entry.url );
			const html = readFileSync( join( websiteDir, routePath ), 'utf8' );
			yield {
				sourcePath: `website/${ routePath }`,
				html,
				identityHtml: readFileSync( entry.identityHtmlPath!, 'utf8' ),
				observations,
			};
		}
	};
	const geometry = buildLayoutGeometryProof( geometryInputs );
	const geometryReport = {
		...geometry.report,
		capture_omissions: geometryCaptureOmissions,
	};
	writeFileSync(
		join( outputDir, 'layout-geometry-report.json' ),
		`${ JSON.stringify( geometryReport, null, 2 ) }\n`
	);
	if ( geometry.proof )
		writeFileSync(
			join( outputDir, 'layout-geometry-proof.json' ),
			`${ JSON.stringify( geometry.proof, null, 2 ) }\n`
		);

	const interactionStates = interactionPages.flatMap( ( page ) => page.states );
	const initialDialogs = interactionPages.flatMap( ( page ) => page.initialDialogs ?? [] );
	const interactionSummary = {
		candidate_count: interactionStates.length,
		captured_count: interactionStates.filter( ( state ) => state.status === 'captured' ).length,
		no_dialog_count: interactionStates.filter( ( state ) => state.status === 'no-dialog' ).length,
		click_failed_count: interactionStates.filter( ( state ) => state.status === 'click-failed' )
			.length,
		truncated_count: interactionStates.filter(
			( state ) => state.status === 'captured' && state.dialog?.htmlTruncated
		).length,
		initial_dialog_count: initialDialogs.length,
		initial_captured_count: initialDialogs.filter( ( state ) => state.status === 'captured' ).length,
		initial_dismissal_verified_count: initialDialogs.filter(
			( state ) => state.dismissal?.verified
		).length,
	};
	if ( semanticEvidence ) {
		writeFileSync( join( outputDir, semanticEvidence.index.path ), semanticEvidence.index.content );
		for ( const shard of semanticEvidence.shards ) {
			const path = join( outputDir, shard.path );
			mkdirSync( dirname( path ), { recursive: true } );
			writeFileSync( path, shard.content );
		}
	}
	if ( interactionPages.length > 0 ) {
		writeFileSync(
			join( outputDir, 'interaction-states.json' ),
			`${ JSON.stringify(
				{
					schema: CAPTURED_INTERACTIONS_SCHEMA,
					pages: interactionPages,
					totals: interactionSummary,
				},
				null,
				2
			) }\n`
		);
	}
	const scrollStatesSummary = {
		page_count: scrollStatesPages.length,
		toggle_count: scrollStatesPages.reduce( ( total, page ) => total + page.toggles.length, 0 ),
	};
	if ( scrollStatesPages.length > 0 ) {
		writeFileSync(
			join( outputDir, 'scroll-states.json' ),
			`${ JSON.stringify(
				{
					schema: CAPTURED_SCROLL_STATES_SCHEMA,
					pages: scrollStatesPages,
					totals: scrollStatesSummary,
				},
				null,
				2
			) }\n`
		);
	}

	// --- source profile -------------------------------------------------------
	// What the source actually does, measured rather than assumed: whether it
	// serves one document or one per device, whether its geometry is authored or
	// written by a runtime, and where it changes behavior. Downstream stages
	// consume this instead of hardcoding viewports and breakpoints.
	const routesWithMobile = retainedEntries.filter( ( entry ) => entry.hasMobileDocument ).length;
	const learnedApplied = fluidReports.reduce( ( total, report ) => total + report.applied, 0 );
	const learnedFrozen = fluidReports.reduce( ( total, report ) => total + report.unmodelled, 0 );
	const observedBreakpoints = [
		...new Set( fluidReports.flatMap( ( report ) => report.breakpoints ) ),
	].sort( ( a, b ) => a - b );
	const sourceProfile = {
		schema: SOURCE_PROFILE_SCHEMA,
		variants: routesWithMobile > 0 ? 'per-device' : 'single',
		documentsPerRoute: routesWithMobile > 0 ? 2 : 1,
		geometry:
			learnedApplied > 0 && learnedFrozen > 0
				? 'mixed'
				: learnedApplied > 0
				? 'runtime-written'
				: 'declarative',
		switchWidth: switchWidths.length > 0 ? Math.max( ...switchWidths ) : null,
		switchWidthSource: switchWidths.length > 0 ? 'detected' : 'default',
		breakpoints: observedBreakpoints,
		learned: { applied: learnedApplied, frozen: learnedFrozen, routes: fluidReports.length },
	};
	writeFileSync(
		join( outputDir, 'source-profile.json' ),
		`${ JSON.stringify( sourceProfile, null, 2 ) }\n`
	);
	const assetEvidenceReport = assetEvidence(
		assetReferenceLocations,
		mediaStubs,
		resourceManifest,
		portablePathsBySource,
		outputDir
	);
	writeFileSync(
		join( outputDir, 'asset-evidence.json' ),
		`${ JSON.stringify(
			{
				schema: ASSET_EVIDENCE_SCHEMA,
				assetCount: assetEvidenceReport.assetCount,
				assetCountExact: assetEvidenceReport.assetCountExact,
				totalReferenceCount: assetEvidenceReport.totalReferenceCount,
				assetsTruncated: assetEvidenceReport.assetsTruncated,
				referenceLimit: MAX_ASSET_EVIDENCE_REFERENCES,
				coverage: {
					retainedRouteCount: retainedEntries.length,
					documentCount: assetReferenceLocations.documentCount,
					assetLimit: MAX_ASSET_EVIDENCE_ASSETS,
					assetSelection: 'first reachable source URLs in retained route traversal',
					cssTraversal: 'reachable captured CSS resources only',
					cssResourcesPerRouteLimit: MAX_ASSET_EVIDENCE_CSS_RESOURCES_PER_ROUTE,
					cssResourcesTruncated: assetReferenceLocations.cssResourcesTruncated,
				},
				assets: assetEvidenceReport.assets,
			},
			null,
			2
		) }\n`
	);

	// Merge capture-time route diagnostics (this route never produced HTML) with
	// discovery-time diagnostics (this route was rejected before capture even
	// started, e.g. a same-origin sitemap leaf) into one reported list — every
	// route the source advertised is now either in `routes` or named here with
	// a reason, never just missing.
	const discoveryDiagnostics = [
		...( options.discoveryDiagnostics ?? [] ),
		...routeCaptureDiagnostics,
	];

	const receiptPath = join( outputDir, 'capture-receipt.json' );
	// Only proven source-absent routes lack a document requiring cleanup.
	// Keep every other attempted route in the audit, even if it lost its HTML.
	const cleanupPages = Object.entries(capture.entries)
		.filter(([url]) => !absentRoutes.has(url))
		.map(([url, entry]) => ({ url, ...entry.cleanup }));
	const recordedPolicy = cleanupPages.find((page) => page.policy)?.policy;
	const cleanup = recordedPolicy ? {
		policy: recordedPolicy,
		evidencePath: 'cleanup-evidence.json',
		complete: cleanupPages.every((page) => page.policy && JSON.stringify(page.policy) === JSON.stringify(recordedPolicy) &&
			page.reports?.length && page.reports.every((report) => report.failures.length === 0 && report.residual === 0)),
	} : undefined;
	if (cleanup) writeFileSync(join(outputDir, 'cleanup-evidence.json'), JSON.stringify({ schema: recordedPolicy!.schema, pages: cleanupPages }, null, 2));
	const complete =
		Number( options.summary.routesFailed ?? 0 ) === 0 &&
		! unresolvedAnchors.some( ( anchor ) => anchor.reason === UNCAPTURED_ROUTE_REASON );

	writeFileSync(
		receiptPath,
		`${ JSON.stringify(
			{
				schema: CAPTURE_RECEIPT_SCHEMA,
				...(cleanup ? { cleanup } : {}),
				websiteRoot: 'website',
				entrypoint: 'website/index.html',
				source: { url: options.sourceUrl, platform: options.platform },
				...( options.title ? { title: options.title } : {} ),
				// Declares the class tokens this capture tool uses to mark one side
				// of a desktop/mobile document pair (see mergeResponsiveDocuments),
				// so a generic consumer can recognize them as a document-scope
				// boundary without hardcoding this tool's naming convention.
				document_scope_classes: [ DESKTOP_DOCUMENT_CLASS, MOBILE_DOCUMENT_CLASS ],
				routes,
				assets,
				assetEvidence: { path: 'asset-evidence.json', schema: ASSET_EVIDENCE_SCHEMA },
				portableMedia,
				interactions: interactionSummary,
				scrollStates: scrollStatesSummary,
				layoutGeometry: geometryReport,
				sourceProfile,
				excludedRoutes,
				duplicateRoutes,
				discoveryDiagnostics,
				summary: { ...options.summary, complete },
			},
			null,
			2
		) }\n`
	);
	writeFileSync(
		join( outputDir, 'diagnostics.json' ),
		`${ JSON.stringify(
			{
				schema: 'data-liberation/capture-diagnostics/v1',
				complete,
				failures: options.failures,
				discoveryDiagnostics,
				resourceFailures: resourceManifest.failures,
				unresolvedDependencies,
				unresolvedMedia: [
					...unresolvedMedia,
					...[ ...rejectedReplacementKeys ].map( ( source ) => ( {
						url: source,
						error: 'skipped degenerate replacement key',
					} ) ),
				],
				unresolvedAnchors,
				portableMedia,
				interactions: interactionSummary,
				scrollStates: scrollStatesSummary,
				interactionFailures: interactionStates.filter( ( state ) => state.status !== 'captured' ),
				excludedRoutes,
				duplicateRoutes,
				styleHoist: {
					hoistedStylesheets: stylesheetPaths.size,
					diagnostics: styleHoistDiagnostics.diagnostics,
					diagnosticCounts: styleHoistDiagnostics.diagnosticCounts,
					diagnosticsTruncated: styleHoistDiagnostics.diagnosticsTruncated,
				},
			},
			null,
			2
		) }\n`
	);
	rmSync( stagedHtmlDir, { recursive: true, force: true } );
	return receiptPath;
}
