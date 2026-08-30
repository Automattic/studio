import type { FidelityCheckResult } from './checks.js';
import type { LayoutObservation, RenderedImage, RenderedTextStyle } from './score.js';

export const IMAGE_POSITION_TOLERANCE_PX = 8;
export const IMAGE_SIZE_TOLERANCE_PX = 4;
export const TYPOGRAPHY_METRIC_TOLERANCE_PX = 1;
export const TYPOGRAPHY_COVERAGE_FLOOR = 0.8;
export const MOTION_COVERAGE_FLOOR = 0.8;

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

/** Match repeated images by identity and nearest geometry rather than array order. */
function matchedImages( source: RenderedImage[], candidate: RenderedImage[] ): ImagePair[] {
	const available = new Map< string, RenderedImage[] >();
	for ( const image of candidate ) {
		const group = available.get( image.key ) ?? [];
		group.push( image );
		available.set( image.key, group );
	}

	const pairs: ImagePair[] = [];
	for ( const image of source ) {
		const group = available.get( image.key );
		if ( ! group?.length ) continue;
		let nearest = 0;
		for ( let index = 1; index < group.length; index++ ) {
			if ( imageDistance( image, group[ index ] ) < imageDistance( image, group[ nearest ] ) ) {
				nearest = index;
			}
		}
		pairs.push( { source: image, candidate: group.splice( nearest, 1 )[ 0 ] } );
	}
	return pairs;
}

export function checkImageGeometry(
	source: LayoutObservation,
	candidate: LayoutObservation
): FidelityCheckResult {
	const moved = matchedImages( source.images, candidate.images ).filter( ( pair ) => {
		const { source: left, candidate: right } = pair;
		return (
			Math.abs( left.x - right.x ) > IMAGE_POSITION_TOLERANCE_PX ||
			Math.abs( left.y - right.y ) > IMAGE_POSITION_TOLERANCE_PX ||
			Math.abs( left.width - right.width ) > IMAGE_SIZE_TOLERANCE_PX ||
			Math.abs( left.height - right.height ) > IMAGE_SIZE_TOLERANCE_PX
		);
	} );
	if ( moved.length === 0 ) return {};

	return {
		failures: [
			`image geometry differs for ${ moved.length } matched image(s): ${ moved
				.slice( 0, 3 )
				.map( ( { source: left, candidate: right } ) =>
					`${ left.key } source ${ left.width }x${ left.height } at (${ left.x },${ left.y }), copy ${ right.width }x${ right.height } at (${ right.x },${ right.y })`
				)
				.join( '; ' ) }`,
		],
	};
}

function normalizedFamily( family: string ): string {
	return family.toLowerCase().replace( /["']/g, '' ).replace( /\s+/g, ' ' ).trim();
}

function styleDistance( source: RenderedTextStyle, candidate: RenderedTextStyle ): number {
	return (
		( normalizedFamily( source.fontFamily ) === normalizedFamily( candidate.fontFamily ) ? 0 : 1000 ) +
		( source.fontWeight === candidate.fontWeight ? 0 : 100 ) +
		Math.abs( source.fontSize - candidate.fontSize ) +
		Math.abs( source.lineHeight - candidate.lineHeight ) +
		Math.abs( source.letterSpacing - candidate.letterSpacing ) +
		Math.abs( source.advance - candidate.advance )
	);
}

interface TextPair {
	source: RenderedTextStyle;
	candidate: RenderedTextStyle;
}

function matchedTextStyles(
	source: RenderedTextStyle[],
	candidate: RenderedTextStyle[]
): TextPair[] {
	const available = new Map< string, RenderedTextStyle[] >();
	for ( const style of candidate ) {
		const group = available.get( style.key ) ?? [];
		group.push( style );
		available.set( style.key, group );
	}
	const pairs: TextPair[] = [];
	for ( const style of source ) {
		const group = available.get( style.key );
		if ( ! group?.length ) continue;
		let nearest = 0;
		for ( let index = 1; index < group.length; index++ ) {
			if ( styleDistance( style, group[ index ] ) < styleDistance( style, group[ nearest ] ) ) {
				nearest = index;
			}
		}
		pairs.push( { source: style, candidate: group.splice( nearest, 1 )[ 0 ] } );
	}
	return pairs;
}

function typographyDifferences( source: RenderedTextStyle, candidate: RenderedTextStyle ): string[] {
	const differences: string[] = [];
	if ( normalizedFamily( source.fontFamily ) !== normalizedFamily( candidate.fontFamily ) ) {
		differences.push( `family ${ candidate.fontFamily } !== ${ source.fontFamily }` );
	}
	if ( source.fontWeight !== candidate.fontWeight ) {
		differences.push( `weight ${ candidate.fontWeight } !== ${ source.fontWeight }` );
	}
	for ( const [ label, left, right ] of [
		[ 'size', source.fontSize, candidate.fontSize ],
		[ 'line-height', source.lineHeight, candidate.lineHeight ],
		[ 'letter-spacing', source.letterSpacing, candidate.letterSpacing ],
		[ 'advance', source.advance, candidate.advance ],
	] as const ) {
		if ( Math.abs( left - right ) > TYPOGRAPHY_METRIC_TOLERANCE_PX ) {
			differences.push( `${ label } ${ right }px !== ${ left }px` );
		}
	}
	if ( source.loaded && ! candidate.loaded ) differences.push( 'font face is not loaded' );
	return differences;
}

export function checkTypography(
	source: LayoutObservation,
	candidate: LayoutObservation
): FidelityCheckResult {
	const sourceStyles = source.typography ?? [];
	const candidateStyles = candidate.typography ?? [];
	if ( sourceStyles.length === 0 ) return {};
	if ( candidateStyles.length === 0 ) {
		return { failures: [ `typography missing for ${ sourceStyles.length } source text run(s)` ] };
	}

	const matchedStyles = matchedTextStyles( sourceStyles, candidateStyles );
	const coverage = matchedStyles.length / sourceStyles.length;
	if ( coverage < TYPOGRAPHY_COVERAGE_FLOOR ) {
		return {
			failures: [
				`typography coverage ${ matchedStyles.length } of ${ sourceStyles.length } (${ Math.round(
					coverage * 100
				) }%) is below ${ Math.round( TYPOGRAPHY_COVERAGE_FLOOR * 100 ) }%`,
			],
		};
	}

	const mismatches = matchedStyles
		.map( ( pair ) => ( { ...pair, differences: typographyDifferences( pair.source, pair.candidate ) } ) )
		.filter( ( pair ) => pair.differences.length > 0 );
	if ( mismatches.length === 0 ) return {};

	return {
		failures: [
			`typography differs for ${ mismatches.length } matched text run(s): ${ mismatches
				.slice( 0, 3 )
				.map( ( mismatch ) => `"${ mismatch.source.key.slice( 0, 40 ) }" ${ mismatch.differences.join( ', ' ) }` )
				.join( '; ' ) }`,
		],
	};
}

function matchedAnimationCount( source: string[], candidate: string[] ): number {
	const available = new Map< string, number >();
	for ( const name of candidate ) available.set( name, ( available.get( name ) ?? 0 ) + 1 );
	let matched = 0;
	for ( const name of source ) {
		const left = available.get( name ) ?? 0;
		if ( left === 0 ) continue;
		matched++;
		available.set( name, left - 1 );
	}
	return matched;
}

export function checkMotion(
	source: LayoutObservation,
	candidate: LayoutObservation
): FidelityCheckResult {
	const sourceAnimations = source.animations ?? [];
	const candidateAnimations = candidate.animations ?? [];
	if ( sourceAnimations.length === 0 ) return {};
	const matched = matchedAnimationCount( sourceAnimations, candidateAnimations );
	const coverage = matched / sourceAnimations.length;
	const sourceResponsive = source.responsiveAnimations ?? [];
	const candidateResponsive = candidate.responsiveAnimations ?? [];
	const responsiveMatched = matchedAnimationCount( sourceResponsive, candidateResponsive );
	const responsiveCoverage = sourceResponsive.length
		? responsiveMatched / sourceResponsive.length
		: 1;
	if ( coverage >= MOTION_COVERAGE_FLOOR && responsiveCoverage >= MOTION_COVERAGE_FLOOR ) return {};

	return {
		failures: [
			coverage < MOTION_COVERAGE_FLOOR
				? `animation coverage ${ matched } of ${ sourceAnimations.length } (${ Math.round(
					coverage * 100
				) }%) is below ${ Math.round( MOTION_COVERAGE_FLOOR * 100 ) }%; copy registered ${ candidateAnimations.length } finite CSS animation(s)`
				: `responsive animation coverage ${ responsiveMatched } of ${ sourceResponsive.length } (${ Math.round(
					responsiveCoverage * 100
				) }%) is below ${ Math.round( MOTION_COVERAGE_FLOOR * 100 ) }% after controlled scroll`,
		],
	};
}
