// src/lib/fidelity/score.ts
//
// Score a source observation against the liberated copy at one viewport.
//
// The gate that would have caught the frozen-layout bug: measuring only at the
// capture width certifies the exact failure mode. This compares at a width the
// caller chose, and the check runner picks widths the sweep never sampled.
//
/**
 * One image the page actually renders at this viewport: where it sits (the
 * rounded box, in CSS pixels) plus a normalized source identity. The pair is
 * the stable key — the copy hosts media under its own URLs, so the basename
 * is the only identity that survives localization, and the box is what makes
 * a loss nameable ("the slideshow at the top is gone", not "an image went
 * missing somewhere").
 */
export interface RenderedImage {
	key: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * Perceptual hash of the rendered pixels (8x8 mean-threshold), when the
	 * bytes could be fetched and decoded. URLs are not always identity: a CDN
	 * can serve one asset under several basenames across pages and device
	 * variants, and localization preserves whichever name it saw, so the key
	 * can drift while the picture stays the same.
	 */
	contentHash?: string | null;
}

/** Computed typography for one visible text run. The text key survives DOM
 * wrapper changes while the measured values describe what the browser drew. */
export interface RenderedTextStyle {
	key: string;
	fontFamily: string;
	fontWeight: string;
	fontSize: number;
	lineHeight: number;
	letterSpacing: number;
	/** Canvas advance in CSS pixels using the computed font. Detects fallback
	 * rendering when CSS still names a face that did not load. */
	advance: number;
	loaded: boolean;
}

export interface LayoutObservation {
	/** Viewport width the observation was taken at. */
	viewport: number;
	title: string;
	/** Visible text length after collapsing whitespace. */
	textChars: number;
	/** Widest visible image, in CSS pixels. Null when none. */
	widestImage: number | null;
	/** Images rendering with real layout space at this viewport. Tracking
	 *  pixels and hidden decorations are excluded by the observer. */
	images: RenderedImage[];
	/** Representative visible text runs and their computed rendering. */
	typography?: RenderedTextStyle[];
	/** Finite CSS animation names currently attached to rendered elements. */
	animations?: string[];
	/** Finite CSS animations that appeared, advanced, or changed play state
	 * during a controlled scroll probe. */
	responsiveAnimations?: string[];
	/** documentElement.scrollWidth. */
	docWidth: number;
	/** True when the document is wider than the viewport. */
	overflow: boolean;
	/** Hosts the page requested that are not the local copy. */
	externalHosts: string[];
	/** Same-page hash targets found on this document. */
	hashTargets: HashTarget[];
	/** Internal pathnames whose local copy 404s. Empty on the live source. */
	internalMissing: string[];
	/** Click-to-open dialogs/menus observed on this document. */
	dialogs: DialogProbe[];
}

export interface DialogProbe {
	label: string;
	opened: boolean;
}

export interface HashTarget {
	fragment: string;
	resolved: boolean;
	/** Elements this fragment matches. More than one and the browser silently
	 *  picks the first, which is how a per-device copy sends a mobile anchor to
	 *  the hidden desktop section. */
	targets: number;
}

export interface ViewportScore {
	viewport: number;
	pass: boolean;
	failures: string[];
	notes: string[];
	source: LayoutObservation;
	liberated: LayoutObservation;
}

/** Image width may drift by a pixel of rounding; more than this is a freeze. */
export const IMAGE_TOLERANCE_PX = 2;

/**
 * The copy may render this many fewer images than the source at a single
 * viewport without failing. One is the largest drift still explained by
 * known-benign causes: a carousel parked on a different slide between the two
 * observations, or a single below-the-fold image only the live source
 * hydrated with an intrinsic size inside the settle window. Real losses
 * arrive in sets — the empty-slideshow regression dropped every slide (three
 * or more) at once at every width — so more than one missing image at the
 * same viewport is treated as content loss, not noise.
 */
export const MISSING_IMAGE_TOLERANCE = 1;

/**
 * Stable identity for one rendered image, built to survive localization.
 *
 * The identity has to hold across three renamings, because the source URL and
 * the copy's URL are never the same string:
 *
 * - **Directory.** The copy re-hosts media under its own path, so only the
 *   basename can contribute.
 * - **Extension.** Capture negotiates image formats, so a source `.png` is
 *   commonly served from the copy as `.avif`. Format is not identity.
 * - **Separators and suffixes.** Wix media ids carry a `~` that localization
 *   rewrites to `-`, and both WordPress and our own collision handling append
 *   numeric and generated-size suffixes.
 *
 * So `…~mv2.png` on wixstatic and `…-mv2-2.avif` in the copy are one image,
 * as are `hero.jpg`, `hero-2.jpg`, `hero-1024x576.jpg` and `hero-scaled.jpg`.
 * Inline and runtime-minted payloads collapse to a stable token because their
 * URLs are not a comparable identity.
 */
export function normalizeImageKey( src: string ): string {
	if ( ! src ) return '';
	if ( src.startsWith( 'data:' ) ) return `data:${ src.slice( 5 ).split( ';' )[ 0 ] ?? '' }`;
	if ( src.startsWith( 'blob:' ) ) return 'blob:';
	const path = src.split( /[?#]/ )[ 0 ] ?? '';
	const slash = path.lastIndexOf( '/' );
	const name = ( slash >= 0 ? path.slice( slash + 1 ) : path ).toLowerCase();
	const stem = name.replace( /\.[a-z0-9]+$/, '' );
	const folded = stem.replace( /~/g, '-' );
	const stripped = folded.replace( /-(?:\d+x\d+|scaled|\d+)$/, '' );
	return stripped || folded || name;
}

/**
 * Source images with no copy counterpart, matched key-by-key as a multiset so
 * a page using the same file twice must render it twice. Extra copy images
 * are not the caller's problem: additions do not fail this gate.
 */
function missingRenderedImages( source: RenderedImage[], copy: RenderedImage[] ): RenderedImage[] {
	const paired = new Set( matchRenderedImages( source, copy ).map( ( pair ) => pair.source ) );
	return source.filter( ( image ) => ! paired.has( image ) );
}

interface ImagePair {
	source: RenderedImage;
	candidate: RenderedImage;
}

function imageDistance( source: RenderedImage, candidate: RenderedImage ): number {
	return (
		Math.abs( source.x - candidate.x ) +
		Math.abs( source.y - candidate.y ) +
		Math.abs( source.width - candidate.width ) +
		Math.abs( source.height - candidate.height )
	);
}

/**
 * Pair each source image with the copy image that renders the same picture.
 *
 * Two identities are available and neither subsumes the other:
 *
 * - **Content.** The perceptual hash survives every renaming, but it is only
 *   present when both sides' bytes could be fetched and decoded.
 * - **URL key.** `normalizeImageKey` folds basenames, but a CDN can serve one
 *   asset under several names across pages and device variants, so the key
 *   can drift while the picture stays the same.
 *
 * Content is tried first — it is the stronger claim — and the URL key covers
 * whatever the hashes missed. Within a tier the nearest geometry wins, the
 * same discipline the key-only matcher always used. A copy image is consumed
 * by at most one pair, so a page rendering the same asset twice must render
 * it twice.
 */
export function matchRenderedImages( source: RenderedImage[], copy: RenderedImage[] ): ImagePair[] {
	const pairs: ImagePair[] = [];
	const paired = new Set< RenderedImage >();

	const nearestIn = ( group: RenderedImage[], image: RenderedImage ): RenderedImage | null => {
		if ( group.length === 0 ) return null;
		let nearest = 0;
		for ( let index = 1; index < group.length; index++ ) {
			if ( imageDistance( image, group[ index ] ) < imageDistance( image, group[ nearest ] ) ) {
				nearest = index;
			}
		}
		return group.splice( nearest, 1 )[ 0 ]!;
	};

	// Tier 1: same picture, whatever it is called on each side.
	if ( source.some( ( image ) => image.contentHash ) ) {
		const byHash = new Map< string, RenderedImage[] >();
		for ( const image of copy ) {
			if ( ! image.contentHash ) continue;
			const group = byHash.get( image.contentHash ) ?? [];
			group.push( image );
			byHash.set( image.contentHash, group );
		}
		for ( const image of source ) {
			if ( ! image.contentHash ) continue;
			const candidate = nearestIn( byHash.get( image.contentHash ) ?? [], image );
			if ( ! candidate ) continue;
			paired.add( candidate );
			pairs.push( { source: image, candidate } );
		}
	}

	// Tier 2: same folded basename, for images whose bytes could not be read.
	const available = new Map< string, RenderedImage[] >();
	for ( const image of copy ) {
		if ( paired.has( image ) ) continue;
		const group = available.get( image.key ) ?? [];
		group.push( image );
		available.set( image.key, group );
	}
	for ( const image of source ) {
		if ( pairs.some( ( pair ) => pair.source === image ) ) continue;
		const candidate = nearestIn( available.get( image.key ) ?? [], image );
		if ( ! candidate ) continue;
		paired.add( candidate );
		pairs.push( { source: image, candidate } );
	}

	return pairs;
}

export function scoreViewport(
	source: LayoutObservation,
	liberated: LayoutObservation
): ViewportScore {
	if ( source.viewport !== liberated.viewport ) {
		throw new Error(
			`Cannot score mismatched viewports: source ${ source.viewport } vs liberated ${ liberated.viewport }`
		);
	}

	const failures: string[] = [];
	const notes: string[] = [];

	if ( source.title !== liberated.title ) {
		failures.push( `title "${ liberated.title }" !== source "${ source.title }"` );
	}
	if ( source.textChars !== liberated.textChars ) {
		failures.push( `text ${ liberated.textChars } chars !== source ${ source.textChars }` );
	}

	if ( source.widestImage === null && liberated.widestImage === null ) {
		notes.push( 'no images' );
	} else if ( source.widestImage === null || liberated.widestImage === null ) {
		failures.push(
			`widest image ${ liberated.widestImage ?? 'none' } !== source ${ source.widestImage ?? 'none' }`
		);
	} else if ( Math.abs( liberated.widestImage - source.widestImage ) > IMAGE_TOLERANCE_PX ) {
		failures.push(
			`widest image ${ liberated.widestImage }px !== source ${ source.widestImage }px (Δ${
				liberated.widestImage - source.widestImage
			})`
		);
	}

	// The empty-slideshow gate: the widest image can survive (a header banner
	// covers it) while an entire slideshow below it renders nothing. Counting
	// what each side actually renders is the only way that regression fails.
	const missingImages = missingRenderedImages( source.images, liberated.images );
	if ( missingImages.length > MISSING_IMAGE_TOLERANCE ) {
		failures.push(
			`images ${ missingImages.length } of ${ source.images.length } missing: ${ missingImages
				.slice( 0, 3 )
				.map(
					( image ) =>
						`${ image.key } ${ image.width }x${ image.height } at (${ image.x },${ image.y })`
				)
				.join( '; ' ) }`
		);
	} else if ( missingImages.length > 0 ) {
		notes.push( `images ${ missingImages.length } missing within tolerance` );
	}
	const matchedImages = source.images.length - missingImages.length;
	if ( liberated.images.length > matchedImages ) {
		notes.push( `images ${ liberated.images.length - matchedImages } extra in copy (not a failure)` );
	}

	if ( liberated.overflow && ! source.overflow ) {
		failures.push( `horizontal overflow at ${ liberated.docWidth }px in a ${ liberated.viewport }px viewport` );
	}

	if ( liberated.externalHosts.length > 0 ) {
		failures.push(
			`copy requested ${ liberated.externalHosts.length } external host(s): ${ liberated.externalHosts
				.slice( 0, 3 )
				.join( ', ' ) }`
		);
	}

	const copyUnresolved = liberated.hashTargets
		.filter( ( target ) => ! target.resolved )
		.map( ( target ) => target.fragment );
	if ( copyUnresolved.length > 0 ) {
		failures.push(
			`nav ${ copyUnresolved.length } same-page anchor(s) missing: #${ copyUnresolved
				.slice( 0, 3 )
				.join( ' #' ) }`
		);
	} else {
		const copyResolved = new Set(
			liberated.hashTargets.filter( ( target ) => target.resolved ).map( ( target ) => target.fragment )
		);
		const lost = source.hashTargets
			.filter( ( target ) => target.resolved && ! copyResolved.has( target.fragment ) )
			.map( ( target ) => target.fragment );
		if ( lost.length > 0 ) {
			failures.push(
				`nav ${ lost.length } same-page anchor(s) missing: #${ lost.slice( 0, 3 ).join( ' #' ) }`
			);
		}
	}

	// Resolving is not the same as resolving correctly. A fragment that matches
	// more elements in the copy than in the source lands somewhere the source
	// never sent it, and `getElementById` reports that as a success.
	const sourceTargets = new Map(
		source.hashTargets.map( ( target ) => [ target.fragment, target.targets ] )
	);
	const ambiguous = liberated.hashTargets
		.filter( ( target ) => target.targets > Math.max( 1, sourceTargets.get( target.fragment ) ?? 1 ) )
		.map( ( target ) => target.fragment );
	if ( ambiguous.length > 0 ) {
		failures.push(
			`nav ${ ambiguous.length } same-page anchor(s) match more than one target: #${ ambiguous
				.slice( 0, 3 )
				.join( ' #' ) }`
		);
	}

	if ( liberated.internalMissing.length > 0 ) {
		failures.push(
			`nav ${ liberated.internalMissing.length } internal link(s) 404: ${ liberated.internalMissing
				.slice( 0, 3 )
				.join( ', ' ) }`
		);
	}

	const copyOpened = ( liberated.dialogs ?? [] )
		.filter( ( dialog ) => dialog.opened )
		.map( ( dialog ) => dialog.label.toLowerCase() );
	const dead = ( source.dialogs ?? [] )
		.filter( ( dialog ) => {
			if ( ! dialog.opened ) return false;
			const label = dialog.label.toLowerCase();
			return ! copyOpened.some( ( opened ) => opened === label || opened.includes( label ) || label.includes( opened ) );
		} )
		.map( ( dialog ) => dialog.label );
	if ( dead.length > 0 ) {
		failures.push( `interactivity ${ dead.length } dialog(s) dead: ${ dead.slice( 0, 3 ).join( ', ' ) }` );
	}

	return {
		viewport: source.viewport,
		pass: failures.length === 0,
		failures,
		notes,
		source,
		liberated,
	};
}

export function scoreReport( scores: ViewportScore[] ): { pass: boolean; failed: number; passed: number } {
	const failed = scores.filter( ( score ) => ! score.pass ).length;
	return { pass: failed === 0, failed, passed: scores.length - failed };
}
