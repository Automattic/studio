import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 14.75 7 17C9.5 19.25 17.25 8.25 20 10.5C22.25 12.5 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const CIRCLE_START = 'C24.3137 13.0294 22.9706 6.3137 18 3';
const CIRCLE_LAP = `${ CIRCLE_START }C13.0294 -0.3137 6.3137 1.0294 3 6C-0.3137 10.9706 1.0294 17.6863 6 21C10.9706 24.3137 17.6863 22.9706 21 18`;
const LOOP_PATH = `${ DRAW_PATH }${ CIRCLE_LAP }${ CIRCLE_START }C13.0294 -0.3137 0 11.5 3 8.5Z`;

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
			const loop = moving.current;
			if (
				reducedMotion ||
				! rest ||
				! loop ||
				animations.current.some( ( animation ) => animation.playState === 'running' )
			)
				return;
			const duration = getMotionDuration( 'reveal' );
			if ( ! duration ) return;
			animations.current.forEach( ( animation ) => animation.cancel() );
			const strokeLength = rest.getTotalLength();
			const loopLength = loop.getTotalLength();
			loop.setAttribute( 'stroke-dasharray', `${ strokeLength } ${ loopLength - strokeLength }` );
			const options = {
				duration,
			};
			const easing = getComputedStyle( document.documentElement )
				.getPropertyValue( '--motion-ease-layout' )
				.trim();
			animations.current = [
				rest.animate( [ { opacity: 0 }, { opacity: 0 } ], options ),
				loop.animate(
					[
						{ opacity: 1, strokeDashoffset: '0px', offset: 0, easing },
						{ opacity: 1, strokeDashoffset: `${ -strokeLength }px`, offset: 0.4 },
						{
							opacity: 1,
							strokeDashoffset: `${ -strokeLength * 1.25 }px`,
							offset: 0.65,
							easing,
						},
						{ opacity: 1, strokeDashoffset: `${ -loopLength }px`, offset: 1 },
					],
					options
				),
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
				d={ LOOP_PATH }
				opacity="0"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
