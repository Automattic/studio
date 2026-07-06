/**
 * On-page SEO audit module for WordPress sites.
 *
 * Loads a page in the shared Playwright browser and extracts on-page SEO
 * signals from the rendered DOM (meta tags, headings, images, links, schema)
 * along with the availability of robots.txt and sitemap.xml.
 *
 * This is a synthetic audit of a local site — it does not use Search Console
 * data or rank tracking. Focus on structural fixes the user can apply.
 */

import { getSharedBrowser } from 'cli/ai/browser-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaTagsAudit {
	title: string | null;
	titleLength: number;
	description: string | null;
	descriptionLength: number;
	canonical: string | null;
	robots: string | null;
	viewport: string | null;
	htmlLang: string | null;
	charset: string | null;
}

export interface SocialTagsAudit {
	openGraph: Record< string, string >;
	twitter: Record< string, string >;
}

export interface HeadingsAudit {
	counts: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
	h1Texts: string[];
	skippedLevels: string[];
}

export interface ImagesAudit {
	total: number;
	withAlt: number;
	withoutAlt: number;
	emptyAlt: number;
	missingAltUrls: string[];
}

export interface LinksAudit {
	totalInternal: number;
	totalExternal: number;
	nofollow: number;
	emptyText: number;
	emptyTextHrefs: string[];
}

export interface StructuredDataAudit {
	jsonLdCount: number;
	jsonLdTypes: string[];
}

export interface ResourcesAudit {
	robotsTxtFound: boolean;
	robotsTxtBlocksAll: boolean;
	sitemapFound: boolean;
	sitemapUrl: string | null;
}

export interface SeoMetrics {
	url: string;
	httpStatus: number;
	wordCount: number;
	meta: MetaTagsAudit;
	social: SocialTagsAudit;
	headings: HeadingsAudit;
	images: ImagesAudit;
	links: LinksAudit;
	structuredData: StructuredDataAudit;
	resources: ResourcesAudit;
}

export interface SeoAuditResult {
	url: string;
	timestamp: string;
	metrics: SeoMetrics | null;
	error?: string;
}

// ---------------------------------------------------------------------------
// In-page collection script
// ---------------------------------------------------------------------------

function collectSeoScript( origin: string ) {
	function text( el: Element | null ): string {
		return el?.textContent?.trim() ?? '';
	}

	function attr( selector: string, name: string ): string | null {
		const el = document.querySelector( selector );
		return el ? el.getAttribute( name ) : null;
	}

	const titleEl = document.querySelector( 'title' );
	const titleText = text( titleEl );

	const description = attr( 'meta[name="description" i]', 'content' );
	const canonical = attr( 'link[rel="canonical" i]', 'href' );
	const robots = attr( 'meta[name="robots" i]', 'content' );
	const viewport = attr( 'meta[name="viewport" i]', 'content' );
	const htmlLang = document.documentElement.getAttribute( 'lang' );
	const charset =
		document.characterSet ||
		attr( 'meta[charset]', 'charset' ) ||
		attr( 'meta[http-equiv="Content-Type" i]', 'content' );

	const openGraph: Record< string, string > = {};
	for ( const meta of Array.from(
		document.querySelectorAll( 'meta[property^="og:" i]' )
	) as HTMLMetaElement[] ) {
		const property = meta.getAttribute( 'property' );
		const content = meta.getAttribute( 'content' );
		if ( property && content ) {
			openGraph[ property.toLowerCase() ] = content;
		}
	}

	const twitter: Record< string, string > = {};
	for ( const meta of Array.from(
		document.querySelectorAll( 'meta[name^="twitter:" i]' )
	) as HTMLMetaElement[] ) {
		const name = meta.getAttribute( 'name' );
		const content = meta.getAttribute( 'content' );
		if ( name && content ) {
			twitter[ name.toLowerCase() ] = content;
		}
	}

	const headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
	const h1Texts: string[] = [];
	const seenLevels: number[] = [];
	const skippedLevels: string[] = [];

	for ( const el of Array.from(
		document.querySelectorAll( 'h1, h2, h3, h4, h5, h6' )
	) as HTMLElement[] ) {
		const level = Number( el.tagName.substring( 1 ) ) as 1 | 2 | 3 | 4 | 5 | 6;
		const tag = el.tagName.toLowerCase() as keyof typeof headingCounts;
		headingCounts[ tag ]++;
		if ( level === 1 ) {
			h1Texts.push( text( el ).slice( 0, 200 ) );
		}
		const previous = seenLevels[ seenLevels.length - 1 ];
		if ( previous !== undefined && level > previous + 1 ) {
			skippedLevels.push(
				`${ tag } after h${ previous } (skipped ${ level - previous - 1 } level(s))`
			);
		}
		seenLevels.push( level );
	}

	let imgTotal = 0;
	let imgWithAlt = 0;
	let imgWithoutAlt = 0;
	let imgEmptyAlt = 0;
	const missingAltUrls: string[] = [];
	for ( const img of Array.from( document.querySelectorAll( 'img' ) ) as HTMLImageElement[] ) {
		imgTotal++;
		const alt = img.getAttribute( 'alt' );
		if ( alt === null ) {
			imgWithoutAlt++;
			if ( missingAltUrls.length < 20 ) {
				missingAltUrls.push( img.currentSrc || img.src || '(no src)' );
			}
		} else if ( alt.trim() === '' ) {
			imgEmptyAlt++;
		} else {
			imgWithAlt++;
		}
	}

	let internal = 0;
	let external = 0;
	let nofollow = 0;
	let emptyText = 0;
	const emptyTextHrefs: string[] = [];
	for ( const a of Array.from( document.querySelectorAll( 'a[href]' ) ) as HTMLAnchorElement[] ) {
		const href = a.getAttribute( 'href' ) ?? '';
		if (
			! href ||
			href.startsWith( '#' ) ||
			href.startsWith( 'mailto:' ) ||
			href.startsWith( 'tel:' )
		) {
			continue;
		}
		let isExternal = false;
		try {
			const url = new URL( href, origin );
			isExternal = url.origin !== origin;
		} catch {
			continue;
		}
		if ( isExternal ) {
			external++;
		} else {
			internal++;
		}
		const rel = ( a.getAttribute( 'rel' ) ?? '' ).toLowerCase();
		if ( rel.split( /\s+/ ).includes( 'nofollow' ) ) {
			nofollow++;
		}
		const visibleText = ( a.textContent ?? '' ).trim();
		const hasImage = a.querySelector( 'img[alt]:not([alt=""])' );
		const ariaLabel = a.getAttribute( 'aria-label' )?.trim();
		if ( ! visibleText && ! hasImage && ! ariaLabel ) {
			emptyText++;
			if ( emptyTextHrefs.length < 20 ) {
				emptyTextHrefs.push( href );
			}
		}
	}

	const jsonLdTypes: string[] = [];
	let jsonLdCount = 0;
	for ( const script of Array.from(
		document.querySelectorAll( 'script[type="application/ld+json"]' )
	) ) {
		jsonLdCount++;
		try {
			const parsed = JSON.parse( script.textContent ?? '' );
			const items = Array.isArray( parsed ) ? parsed : [ parsed ];
			for ( const item of items ) {
				const graph = item?.[ '@graph' ];
				const nodes = Array.isArray( graph ) ? graph : [ item ];
				for ( const node of nodes ) {
					const t = node?.[ '@type' ];
					if ( typeof t === 'string' ) {
						jsonLdTypes.push( t );
					} else if ( Array.isArray( t ) ) {
						for ( const v of t ) {
							if ( typeof v === 'string' ) {
								jsonLdTypes.push( v );
							}
						}
					}
				}
			}
		} catch {
			// Ignore malformed JSON-LD blocks; we still report the count.
		}
	}

	const wordCount = ( document.body.innerText || '' )
		.trim()
		.split( /\s+/ )
		.filter( Boolean ).length;

	return {
		title: titleText || null,
		description,
		canonical,
		robots,
		viewport,
		htmlLang,
		charset,
		openGraph,
		twitter,
		headingCounts,
		h1Texts,
		skippedLevels,
		images: {
			total: imgTotal,
			withAlt: imgWithAlt,
			withoutAlt: imgWithoutAlt,
			emptyAlt: imgEmptyAlt,
			missingAltUrls,
		},
		links: {
			totalInternal: internal,
			totalExternal: external,
			nofollow,
			emptyText,
			emptyTextHrefs,
		},
		structuredData: { jsonLdCount, jsonLdTypes: Array.from( new Set( jsonLdTypes ) ) },
		wordCount,
	};
}

// ---------------------------------------------------------------------------
// Robots.txt and sitemap detection
// ---------------------------------------------------------------------------

async function checkResource(
	browser: Awaited< ReturnType< typeof getSharedBrowser > >,
	url: string
): Promise< { ok: boolean; body: string } > {
	const context = await browser.newContext( { ignoreHTTPSErrors: true } );
	try {
		const response = await context.request.get( url, {
			failOnStatusCode: false,
			timeout: 10_000,
		} );
		const ok = response.status() >= 200 && response.status() < 400;
		const body = ok ? await response.text() : '';
		return { ok, body };
	} catch {
		return { ok: false, body: '' };
	} finally {
		await context.close();
	}
}

function robotsBlocksAll( robotsTxt: string ): boolean {
	const lines = robotsTxt.split( /\r?\n/ );
	let inGlobalGroup = false;
	for ( const line of lines ) {
		const trimmed = line.split( '#' )[ 0 ].trim();
		if ( ! trimmed ) {
			continue;
		}
		const [ rawKey, ...rest ] = trimmed.split( ':' );
		const key = rawKey.trim().toLowerCase();
		const value = rest.join( ':' ).trim();
		if ( key === 'user-agent' ) {
			inGlobalGroup = value === '*';
		} else if ( inGlobalGroup && key === 'disallow' && value === '/' ) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const AUDIT_VIEWPORT = { width: 1040, height: 1248 };

export async function auditSeo( siteUrl: string, urlPath = '/' ): Promise< SeoAuditResult > {
	const origin = siteUrl.replace( /\/+$/, '' );
	const targetUrl = `${ origin }${ urlPath }`;

	try {
		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			viewport: AUDIT_VIEWPORT,
			ignoreHTTPSErrors: true,
		} );

		try {
			const response = await page.goto( targetUrl, {
				waitUntil: 'networkidle',
				timeout: 30_000,
			} );

			const httpStatus = response?.status() ?? 0;
			const collected = await page.evaluate( collectSeoScript, origin );

			const [ robotsResult, sitemapAtRoot, sitemapIndex ] = await Promise.all( [
				checkResource( browser, `${ origin }/robots.txt` ),
				checkResource( browser, `${ origin }/sitemap.xml` ),
				checkResource( browser, `${ origin }/sitemap_index.xml` ),
			] );

			let sitemapUrl: string | null = null;
			if ( sitemapAtRoot.ok ) {
				sitemapUrl = `${ origin }/sitemap.xml`;
			} else if ( sitemapIndex.ok ) {
				sitemapUrl = `${ origin }/sitemap_index.xml`;
			} else if ( robotsResult.ok ) {
				const match = robotsResult.body.match( /^\s*Sitemap:\s*(\S+)/im );
				if ( match ) {
					sitemapUrl = match[ 1 ];
				}
			}

			const metrics: SeoMetrics = {
				url: targetUrl,
				httpStatus,
				wordCount: collected.wordCount,
				meta: {
					title: collected.title,
					titleLength: collected.title?.length ?? 0,
					description: collected.description,
					descriptionLength: collected.description?.length ?? 0,
					canonical: collected.canonical,
					robots: collected.robots,
					viewport: collected.viewport,
					htmlLang: collected.htmlLang,
					charset: collected.charset,
				},
				social: {
					openGraph: collected.openGraph,
					twitter: collected.twitter,
				},
				headings: {
					counts: collected.headingCounts,
					h1Texts: collected.h1Texts,
					skippedLevels: collected.skippedLevels,
				},
				images: collected.images,
				links: collected.links,
				structuredData: collected.structuredData,
				resources: {
					robotsTxtFound: robotsResult.ok,
					robotsTxtBlocksAll: robotsResult.ok && robotsBlocksAll( robotsResult.body ),
					sitemapFound: sitemapUrl !== null,
					sitemapUrl,
				},
			};

			return {
				url: targetUrl,
				timestamp: new Date().toISOString(),
				metrics,
			};
		} finally {
			await page.close();
		}
	} catch ( error ) {
		return {
			url: targetUrl,
			timestamp: new Date().toISOString(),
			metrics: null,
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}
