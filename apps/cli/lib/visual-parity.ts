import fs from 'fs';
import path from 'path';
import { launchChromiumWithInstall } from 'cli/ai/browser-utils';

type Browser = Awaited< ReturnType< typeof launchChromiumWithInstall > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

// Mirrors constants `static-site-importer`'s `tools/visual-parity-oracle.mjs` exports (merged
// in static-site-importer#1707), reproduced here because Studio cannot import them directly —
// the plugin zip is only unpacked into a running site's filesystem at runtime (and, for
// PHP-WASM/Playground sites, into a virtual filesystem Studio's own Node process cannot read
// directly at all), not available as a build-time npm dependency.
//
// static-site-importer#1710 (already merged, ahead of what this file targets) replaced
// `Static_Site_Importer_Visual_Parity_Oracle`'s entire contract with an incompatible one
// (schema `static-site-importer/layout-baseline/v1`, different field names throughout:
// `offset.top` not `top`, `headings[].font_size` objects not `headingSizes` numbers, a broader
// `media` query — img/svg/video — not `images`, `forms[].fields[]` carrying `padding` this file
// never captures). That means the constants below, and everything this file sends to
// `visual-parity-eval.php`, no longer match what the currently-merged oracle class expects —
// confirmed by running a real import end-to-end: the oracle degrades to `not_verified` every
// time, regardless of the underlying geometry. static-site-importer#1716 additionally exported
// the extractor itself (`EXTRACT_LAYOUT`) for reuse, but reusing it here would both change what
// this file measures (see `extractImportedSectionPage` below) and still not close the schema
// gap on its own. Fixing this needs a deliberate migration of this whole file's contract to
// `layout-baseline/v1`, not a drop-in extractor swap — tracked separately, out of scope here.
export const VISUAL_PARITY_SCHEMA = 'static-site-importer/visual-parity-oracle-input/v1';
export const VISUAL_PARITY_VIEWPORT = { width: 1440, height: 900 };

type SectionRecord = Record< string, unknown >;
type LandmarkRecord = Record< string, unknown >;

export type CapturedSectionPage = {
	schema?: unknown;
	sourceUrl?: string;
	capturedAt?: string;
	viewport?: unknown;
	sections?: SectionRecord[];
	landmarks?: LandmarkRecord[];
	page?: string;
	[ key: string ]: unknown;
};

export type VisualParityArtifacts = {
	schema: string;
	status: 'ready' | 'not_verified';
	verification: string;
	stage: string;
	reason?: string;
	viewport?: typeof VISUAL_PARITY_VIEWPORT;
	source_pages: Record< string, CapturedSectionPage >;
	imported_pages: Record< string, CapturedSectionPage >;
	omissions?: unknown[];
};

// Matches the shape of `notVerifiedResult()` in static-site-importer's
// `tools/visual-parity-oracle.mjs` — a plain data literal (not extraction logic), so this is
// not a duplicate of the oracle's behavior, only of a documented, versioned response shape.
function notVerifiedResult( reason: string ): VisualParityArtifacts {
	return {
		schema: VISUAL_PARITY_SCHEMA,
		status: 'not_verified',
		verification: 'not_verified',
		stage: 'import_vs_capture',
		reason,
		source_pages: {},
		imported_pages: {},
	};
}

function normalizePageId( value: string ): string {
	const normalized = value
		.toLowerCase()
		.trim()
		.replace( /\.(html?|json)$/, '' )
		.replace( /^\/+|\/+$/g, '' );
	return [ '', 'index', 'home', 'homepage' ].includes( normalized ) ? 'index' : normalized;
}

function routeForCapturedPage( pageId: string, sourceUrl: string | undefined ): string {
	if ( sourceUrl ) {
		try {
			return new URL( sourceUrl ).pathname || '/';
		} catch {
			// Fall through to the id-derived route below.
		}
	}
	return pageId === 'index' ? '/' : `/${ pageId }/`;
}

// DLA records inline SVG icons separately from raster images (`section.icons`, not
// `section.images`) because it tracks them for different purposes upstream. The oracle's
// imported-side extraction has no such distinction — every visible `<img>` counts, including
// ones `blocks-engine` converted from an inline SVG (a documented, healthy conversion; see
// EVIDENCE.md). Folding `icons` into the section's `images` count here keeps the comparison
// apples-to-apples without inventing geometry: icon entries carry no `displayWidth`/
// `displayHeight`, so they only ever participate in the image *count* check, never the
// per-image size check.
function withIconsFoldedIntoImages( section: SectionRecord ): SectionRecord {
	const icons = Array.isArray( section.icons ) ? ( section.icons as SectionRecord[] ) : [];
	if ( icons.length === 0 ) {
		return section;
	}
	const images = Array.isArray( section.images ) ? section.images : [];
	return {
		...section,
		images: [
			...images,
			...icons.map( () => ( { alt: '', url: '', selector: '', kind: 'svg-icon' } ) ),
		],
	};
}

// The same icon/image split applies to DLA's page-level `landmarks[]` (also queried as
// `img, svg, video` in `EXTRACT_SECTIONS`-style code, but DLA's own capture only ever puts a
// count in that field for actual `<img>` elements — never the inline `<svg>` icons it tracks
// separately per section). DLA's own `sections[]` order is content-flow order ending with the
// footer content; every section but the last sits under the `main` landmark, and the last
// belongs to `footer`. Folding each section's icon count into its owning landmark keeps that
// comparison consistent with the same icons-are-healthy-`<img>`-conversions reasoning above.
function withIconsFoldedIntoLandmarks(
	landmarks: LandmarkRecord[],
	sections: SectionRecord[]
): LandmarkRecord[] {
	if ( sections.length === 0 ) {
		return landmarks;
	}
	const iconCountOf = ( section: SectionRecord ) =>
		Array.isArray( section.icons ) ? section.icons.length : 0;
	const mainIcons = sections
		.slice( 0, -1 )
		.reduce( ( sum, section ) => sum + iconCountOf( section ), 0 );
	const footerIcons = iconCountOf( sections[ sections.length - 1 ] );
	const iconsByRole: Record< string, number > = { main: mainIcons, footer: footerIcons };
	return landmarks.map( ( landmark ) => {
		const extra = iconsByRole[ String( landmark.role ) ];
		if ( ! extra || typeof landmark.mediaCount !== 'number' ) {
			return landmark;
		}
		return { ...landmark, mediaCount: landmark.mediaCount + extra };
	} );
}

// Reads the Data Liberation capture's `sections/*.json` files as-is (the DLA capture pipeline
// already extracts these while rendering the live source, and that capture is the trusted,
// pixel-exact stage — see EVIDENCE.md). Studio does not re-extract the source side; it only
// reads what DLA already produced and tags each record with an explicit `page` id so the PHP
// oracle pairs it with the matching imported record deterministically.
export function loadCapturedSectionPages(
	sectionsDir: string
): Record< string, CapturedSectionPage > {
	const pages: Record< string, CapturedSectionPage > = {};
	let entries: string[];
	try {
		entries = fs.readdirSync( sectionsDir ).filter( ( name ) => name.endsWith( '.json' ) );
	} catch {
		return pages;
	}
	for ( const name of entries ) {
		const pageId = normalizePageId( path.basename( name, '.json' ) );
		try {
			const parsed = JSON.parse( fs.readFileSync( path.join( sectionsDir, name ), 'utf8' ) );
			if ( parsed && typeof parsed === 'object' ) {
				const rawSections = Array.isArray( parsed.sections ) ? parsed.sections : [];
				const sections = rawSections.map( withIconsFoldedIntoImages );
				const landmarks = Array.isArray( parsed.landmarks )
					? withIconsFoldedIntoLandmarks( parsed.landmarks, rawSections )
					: parsed.landmarks;
				pages[ pageId ] = { ...parsed, sections, landmarks, page: pageId };
			}
		} catch {
			// A malformed capture section file degrades that one page, not the whole check.
		}
	}
	return pages;
}

// Polled readiness predicate — never `networkidle`, never a swallowed timeout. A genuinely
// unsettled page throws, which the caller treats as "could not measure" rather than a passing
// (or silently wrong) comparison. Ported from the reference probe (`probe/measure.mjs`): the
// predicate settles on "all images that exist are decoded", not "images exist", since a page
// may legitimately have none.
export async function waitForPageReadiness(
	page: Page,
	url: string,
	options: { timeoutMs?: number; pollMs?: number; stableTicks?: number } = {}
): Promise< void > {
	const { timeoutMs = 20_000, pollMs = 250, stableTicks = 6 } = options;

	const response = await page.goto( url, { waitUntil: 'commit', timeout: 30_000 } );
	if ( response && response.status() >= 400 ) {
		throw Object.assign( new Error( `${ url } responded with HTTP ${ response.status() }.` ), {
			httpStatus: response.status(),
		} );
	}
	await page.waitForLoadState( 'domcontentloaded' );

	let previousSignature: string | null = null;
	let stableTickCount = 0;
	const maxTicks = Math.ceil( timeoutMs / pollMs );
	let settled = false;
	for ( let tick = 0; tick < maxTicks; tick++ ) {
		const signature = await page.evaluate( () => ( {
			nodeCount: document.querySelectorAll( '*' ).length,
			imageCount: document.images.length,
			decodedImageCount: Array.from( document.images ).filter(
				( image ) => image.complete && image.naturalWidth > 0
			).length,
			height: document.documentElement.scrollHeight,
		} ) );
		const key = `${ signature.nodeCount }|${ signature.imageCount }|${ signature.decodedImageCount }|${ signature.height }`;
		stableTickCount = key === previousSignature ? stableTickCount + 1 : 0;
		previousSignature = key;
		if ( stableTickCount >= stableTicks && signature.decodedImageCount === signature.imageCount ) {
			settled = true;
			break;
		}
		await page.waitForTimeout( pollMs );
	}
	if ( ! settled ) {
		throw new Error( `${ url } never settled to a stable, fully-decoded render.` );
	}

	// Scroll through the full page so anything gated on intersection/lazy-loading has a chance
	// to mount before the section geometry below is measured.
	await page.evaluate( async () => {
		const step = window.innerHeight;
		for ( let y = 0; y < document.documentElement.scrollHeight; y += step ) {
			window.scrollTo( 0, y );
			await new Promise( ( resolve ) => setTimeout( resolve, 120 ) );
		}
		window.scrollTo( 0, 0 );
	} );
	await page.waitForTimeout( 800 );
}

// Extracts section/landmark geometry from the current (already-ready) page in the shape the
// *originally merged* SSI oracle (static-site-importer#1707) read: `sections[].top`,
// `.height`, `.headingSizes`, `.images[].displayWidth/displayHeight`, `.forms[].fields[]`, and
// `landmarks[].role/height/mediaCount`. This selection heuristic (header/main/section/footer
// and ARIA landmark roles, plus two fixes this file adds — excluding `<header>` as its own
// section, and excluding a wrapping `<main>` that already contains other qualifying sections,
// both confirmed gaps against real WordPress block output) was ported from that PR's
// `EXTRACT_SECTIONS`, which at the time was not exported.
//
// static-site-importer#1716 has since exported that repo's *current* extractor
// (`EXTRACT_LAYOUT`, from static-site-importer#1710) so it can be imported directly. It was
// evaluated for this file and found not to be a safe drop-in: `EXTRACT_LAYOUT` neither excludes
// `<header>` nor un-wraps `<main>` the way this function does (so switching to it would change
// section counts/boundaries for the exact WordPress output this measures — a real extraction-
// behavior change, not just a rename), and it emits the newer `layout-baseline/v1` field shapes
// this file does not consume (see the schema comment above). Adopting it would require this
// whole file's output contract to change too. Until that migration happens, this remains a
// deliberate, disclosed duplicate — keep it in sync with static-site-importer's extractor if
// its *shared* selection heuristic (the base selector/isVisible/displayBox logic) changes.
export async function extractImportedSectionPage(
	page: Page,
	sourceUrl: string
): Promise< CapturedSectionPage > {
	const extracted = await page.evaluate( () => {
		const headingSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
		const isVisible = ( element: Element ) => {
			const style = window.getComputedStyle( element );
			if (
				style.display === 'none' ||
				style.visibility === 'hidden' ||
				Number( style.opacity ) === 0
			) {
				return false;
			}
			const box = element.getBoundingClientRect();
			return box.width > 0 && box.height > 0;
		};
		const displayBox = ( element: Element ) => {
			const box = element.getBoundingClientRect();
			return { displayWidth: Math.round( box.width ), displayHeight: Math.round( box.height ) };
		};
		const sectionNodes = [
			...document.querySelectorAll(
				'header, main, section, footer, [role="banner"], [role="main"], [role="contentinfo"]'
			),
		].filter( ( element ) => isVisible( element ) && element.getBoundingClientRect().height >= 32 );
		// The captured source's `sections[]` (Data Liberation's own record — see
		// `loadCapturedSectionPages`) never includes the page header/nav: it starts at the
		// first content row and its last entry is the footer content. WordPress block output
		// always renders a `<header>` landmark first, so counting it as a section here would
		// shift every later index by one and manufacture disagreements for content that
		// actually matches. `<header>`/`[role="banner"]` is measured only as a landmark.
		const isHeaderLandmark = ( element: Element ) =>
			element.tagName === 'HEADER' || element.getAttribute( 'role' ) === 'banner';
		// WordPress block output commonly wraps a page's `<section>` group blocks in one
		// outer `<main>` landmark (`blocks-engine`'s standard "flex-1" content wrapper). The
		// captured source has no such wrapper, so without this check `<main>` would swallow
		// every nested `<section>` into a single page-spanning "section" and the comparison
		// would be meaningless. A `<main>`/`[role="main"]` landmark that contains other
		// qualifying sections is excluded from `sections[]` (it still appears in
		// `landmarks[]`) so its children are measured individually; a `<main>` with no such
		// children (e.g. a simple page) still falls back to being its own section.
		const isMainLandmark = ( element: Element ) =>
			element.tagName === 'MAIN' || element.getAttribute( 'role' ) === 'main';
		const kept: Element[] = [];
		const sections = [];
		for ( const element of sectionNodes ) {
			if ( isHeaderLandmark( element ) ) {
				continue;
			}
			if ( kept.some( ( existing ) => existing.contains( element ) ) ) {
				continue;
			}
			if (
				isMainLandmark( element ) &&
				sectionNodes.some( ( other ) => other !== element && element.contains( other ) )
			) {
				continue;
			}
			kept.push( element );
			const box = element.getBoundingClientRect();
			const headings = [ ...element.querySelectorAll( headingSelector ) ].filter(
				( heading ) =>
					heading.parentElement?.closest( 'header, main, section, footer' ) === element ||
					heading.closest( 'header, main, section, footer' ) === element
			);
			const images = [ ...element.querySelectorAll( 'img' ) ]
				.filter( isVisible )
				.map( ( image ) => ( {
					alt: image.getAttribute( 'alt' ) || '',
					url: image.currentSrc || image.src || '',
					selector: image.id ? `#${ image.id }` : '',
					kind: 'img',
					...displayBox( image ),
				} ) );
			const forms = [ ...element.querySelectorAll( 'form' ) ].map( ( form ) => ( {
				fields: [ ...form.querySelectorAll( 'input, select, textarea' ) ].map( ( field ) => ( {
					kind: ( field.getAttribute( 'type' ) || field.tagName ).toLowerCase(),
					name: field.getAttribute( 'name' ) || '',
					label: field.getAttribute( 'aria-label' ) || field.id || '',
					tabindex: ( field as HTMLElement ).tabIndex,
					ariaHidden: field.getAttribute( 'aria-hidden' ) === 'true',
					...displayBox( field ),
				} ) ),
			} ) );
			sections.push( {
				sectionIndex: sections.length,
				selector: [
					element.tagName.toLowerCase(),
					element.id ? `#${ element.id }` : '',
					element.className
						? `.${ String( element.className ).trim().split( /\s+/ ).slice( 0, 3 ).join( '.' ) }`
						: '',
				].join( '' ),
				top: Math.round( box.top + window.scrollY ),
				height: Math.round( box.height ),
				headings: headings
					.map( ( heading ) => ( heading.textContent || '' ).trim() )
					.filter( Boolean ),
				headingSizes: headings.map( ( heading ) =>
					Math.round( Number.parseFloat( window.getComputedStyle( heading ).fontSize ) || 0 )
				),
				images,
				forms,
			} );
		}
		const landmarks = [
			...document.querySelectorAll(
				'header, main, footer, [role="banner"], [role="main"], [role="contentinfo"]'
			),
		]
			.filter( isVisible )
			.map( ( element ) => {
				const box = element.getBoundingClientRect();
				const role =
					element.getAttribute( 'role' ) ||
					{ HEADER: 'header', MAIN: 'main', FOOTER: 'footer' }[
						element.tagName as 'HEADER' | 'MAIN' | 'FOOTER'
					] ||
					element.tagName.toLowerCase();
				return {
					role,
					tag: element.tagName.toLowerCase(),
					selector: element.tagName.toLowerCase() + ( element.id ? `#${ element.id }` : '' ),
					top: Math.round( box.top + window.scrollY ),
					height: Math.round( box.height ),
					textLength: ( element.textContent || '' ).trim().length,
					mediaCount: element.querySelectorAll( 'img, svg, video' ).length,
					linkCount: element.querySelectorAll( 'a[href]' ).length,
				};
			} );
		return {
			viewport: { width: window.innerWidth, height: window.innerHeight },
			sections,
			landmarks,
		};
	} );

	return {
		schema: 'studio/imported-section-page/v1',
		sourceUrl,
		capturedAt: new Date().toISOString(),
		...extracted,
	};
}

export type VisualParityLogger = {
	warn: ( message: string ) => void;
};

// Shape of `Static_Site_Importer_Visual_Parity_Oracle::evaluate()`'s return value (SSI's own,
// already-merged evaluator — see `apps/cli/php/visual-parity-eval.php`), not something Studio
// computes.
export type VisualParityDisagreement = {
	page: string;
	section: number | null;
	code: string;
	message: string;
	context?: Record< string, unknown >;
};

export type VisualParityEvaluation = {
	status: 'passed' | 'failed' | 'skipped';
	reason?: string;
	disagreements?: VisualParityDisagreement[];
	[ key: string ]: unknown;
};

export function describeVisualParityFailure( evaluation: VisualParityEvaluation ): string {
	const disagreements = evaluation.disagreements ?? [];
	if ( disagreements.length === 0 ) {
		return evaluation.reason || 'Imported section geometry disagrees with the capture.';
	}
	return disagreements
		.slice( 0, 5 )
		.map(
			( disagreement ) =>
				`${ disagreement.page }${
					disagreement.section !== null && disagreement.section !== undefined
						? `#${ disagreement.section }`
						: ''
				} (${ disagreement.code }): ${ disagreement.message }`
		)
		.join( ' ' );
}

// Orchestrates the whole comparison: reads `source_pages` from the DLA capture (already on
// disk, no re-extraction) and measures `imported_pages` from the now-live imported WordPress
// site, one route per captured page. A route that cannot be measured (readiness never settles,
// navigation throws) is dropped from both sides rather than reported as a pass; a route the
// imported site answers with an HTTP error is kept on the source side only, so the oracle
// reports a real `missing_imported_page` disagreement instead of masking it.
export async function buildVisualParityValidationArtifacts( {
	sectionsDir,
	importedOrigin,
	logger,
}: {
	sectionsDir: string;
	importedOrigin: string;
	logger: VisualParityLogger;
} ): Promise< VisualParityArtifacts > {
	const sourcePages = loadCapturedSectionPages( sectionsDir );
	if ( Object.keys( sourcePages ).length === 0 ) {
		return notVerifiedResult( 'No captured section records were available to compare.' );
	}

	let browser: Browser | undefined;
	const measuredSourcePages: Record< string, CapturedSectionPage > = {};
	const importedPages: Record< string, CapturedSectionPage > = {};
	try {
		browser = await launchChromiumWithInstall(
			{ headless: true, args: [ '--ignore-certificate-errors' ] },
			'the Studio visual parity check'
		);
		for ( const [ pageId, sourcePage ] of Object.entries( sourcePages ) ) {
			const route = routeForCapturedPage( pageId, sourcePage.sourceUrl );
			const target = new URL( route, importedOrigin ).href;
			const page = await browser.newPage( {
				viewport: VISUAL_PARITY_VIEWPORT,
				ignoreHTTPSErrors: true,
			} );
			try {
				await waitForPageReadiness( page, target );
				importedPages[ pageId ] = await extractImportedSectionPage( page, target );
				measuredSourcePages[ pageId ] = sourcePage;
			} catch ( error ) {
				const httpStatus =
					error && typeof error === 'object' && 'httpStatus' in error
						? ( error as { httpStatus?: number } ).httpStatus
						: undefined;
				if ( typeof httpStatus === 'number' && httpStatus >= 400 ) {
					// A real "this page didn't import" signal — keep the source record so the
					// oracle reports a genuine missing_imported_page disagreement.
					measuredSourcePages[ pageId ] = sourcePage;
					logger.warn(
						`Visual parity: ${ target } responded with HTTP ${ httpStatus }; treating "${ pageId }" as missing on the imported site.`
					);
				} else {
					logger.warn(
						`Visual parity: could not measure "${ pageId }" at ${ target } (${
							error instanceof Error ? error.message : String( error )
						}); excluding it from the comparison.`
					);
				}
			} finally {
				await page.close();
			}
		}
	} finally {
		await browser?.close();
	}

	if ( Object.keys( importedPages ).length === 0 ) {
		return notVerifiedResult(
			'No imported page rendered successfully enough to compare against the capture.'
		);
	}

	return {
		schema: VISUAL_PARITY_SCHEMA,
		status: 'ready',
		verification: 'section_geometry',
		stage: 'import_vs_capture',
		viewport: VISUAL_PARITY_VIEWPORT,
		source_pages: measuredSourcePages,
		imported_pages: importedPages,
		omissions: [],
	};
}
