import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 14.75 7 17C9.5 19.25 17.25 8.25 20 10.5C22.25 12.5 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const TRAVEL_PATH = `${ DRAW_PATH }
	C24 14.25 20.75 5.5 14.5 3.75C8.25 2 2 7.25 3.5 13.5
	C5 19.75 15 21.75 19.25 16C23.5 10.25 14.75 1.75 9 4
	C3.25 6.25 0 11.5 3 8.5${ DRAW_PATH.slice( DRAW_PATH.indexOf( 'C' ) ) }`;

function createStringFrames( rest: SVGPathElement, travel: SVGPathElement ): Keyframe[] {
	const length = rest.getTotalLength();
	const distance = travel.getTotalLength();
	const route = Array.from( { length: 257 }, ( _, i ) =>
		travel.getPointAtLength( ( distance * i ) / 256 )
	);
	const sample = ( position: number ) => {
		const index = Math.min( 256, ( position / distance ) * 256 );
		const start = Math.min( 255, Math.floor( index ) );
		const fraction = index - start;
		return {
			x: route[ start ].x + ( route[ start + 1 ].x - route[ start ].x ) * fraction,
			y: route[ start ].y + ( route[ start + 1 ].y - route[ start ].y ) * fraction,
		};
	};
	const restingPoints = Array.from( { length: 129 }, ( _, i ) =>
		rest.getPointAtLength( ( length * i ) / 128 )
	);
	const measure = ( points: { x: number; y: number }[] ) =>
		points.reduce(
			( total, point, i ) =>
				total + ( i ? Math.hypot( point.x - points[ i - 1 ].x, point.y - points[ i - 1 ].y ) : 0 ),
			0
		);
	const stringLength = measure( restingPoints );
	return Array.from( { length: 121 }, ( _, frame ) => {
		const progress = frame / 120;
		const points =
			frame === 0 || frame === 120
				? restingPoints
				: restingPoints.map( ( _, i ) => {
						const position = i / 128;
						const delay = ( 1 - position ) * 0.1;
						const advance = Math.max( 0, Math.min( 1, ( progress - delay ) / 0.9 ) );
						return sample( length * position + ( distance - length ) * advance );
				  } );
		const head = points[ points.length - 1 ];
		const scale = stringLength / measure( points );
		const path = points
			.map(
				( point, i ) =>
					`${ i ? 'L' : 'M' }${ ( head.x + ( point.x - head.x ) * scale ).toFixed( 4 ) } ${ (
						head.y +
						( point.y - head.y ) * scale
					).toFixed( 4 ) }`
			)
			.join( '' );
		return { opacity: 1, d: `path("${ path }")`, offset: progress };
	} );
}

export interface DrawIconHandle {
	play: () => void;
}

export function DrawIcon( {
	ref,
	...props
}: Omit< ComponentProps< 'svg' >, 'ref' > & { ref?: Ref< DrawIconHandle > } ) {
	const still = useRef< SVGPathElement >( null );
	const moving = useRef< SVGPathElement >( null );
	const animations = useRef< Animation[] >( [] );
	const keyframes = useRef< {
		create: typeof createStringFrames;
		frames: Keyframe[];
	} | null >( null );
	const reducedMotion = useReducedMotion();
	useEffect(
		() => () => {
			animations.current.forEach( ( animation ) => animation.cancel() );
			animations.current = [];
		},
		[ reducedMotion ]
	);
	useImperativeHandle( ref, () => ( {
		play() {
			const rest = still.current;
			const line = moving.current;
			if (
				reducedMotion ||
				! rest ||
				! line ||
				! globalThis.CSS?.supports?.( 'd', `path("${ DRAW_PATH }")` ) ||
				animations.current.some( ( animation ) => animation.playState === 'running' )
			)
				return;
			const duration = getMotionDuration( 'reveal' ) * 1.5;
			if ( ! duration ) return;
			animations.current.forEach( ( animation ) => animation.cancel() );
			if ( keyframes.current?.create !== createStringFrames ) {
				keyframes.current = {
					create: createStringFrames,
					frames: createStringFrames( rest, line ),
				};
			}
			const easing = getComputedStyle( document.documentElement )
				.getPropertyValue( '--motion-ease-layout' )
				.trim();
			const options = { duration, easing };
			animations.current = [
				rest.animate( [ { opacity: 0 }, { opacity: 0 } ], options ),
				line.animate( keyframes.current.frames, options ),
			];
			const startTime = document.timeline.currentTime;
			animations.current.forEach( ( animation ) => ( animation.startTime = startTime ) );
		},
	} ) );
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				ref={ still }
				d={ DRAW_PATH }
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				ref={ moving }
				d={ TRAVEL_PATH }
				opacity="0"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
