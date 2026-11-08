import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 14.75 7 17C9.5 19.25 17.25 8.25 20 10.5C22.25 12.5 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const REVERSED_DRAW_CURVES =
	'C20 19.25 18 21.25 16.5 20.5C13.5 19 22.25 12.5 20 10.5C17.25 8.25 9.5 19.25 7 17C4.5 14.75 20 7 17.5 4C15 1 8 3.5 3 8.5';
const TRAVEL_PATH = `M21 18${ REVERSED_DRAW_CURVES }
	C1.6741748 9.8258252 0.4889746 11.3274317 -0.4344119 12.9488861
	C-1.3577984 14.5703406 -2.0193712 16.3116431 -1.4269925 18.0918634
	C-0.8346139 19.8720837 1.0117163 21.6912219 2.7805730 23.0266016
	C4.5494298 24.3619813 6.2408132 25.2136025 8.0318007 25.6934962
	A13.4000933 13.4000933 0 0 0 11.5 26.1500933
	A13.4000933 13.4000933 0 0 0 24.9000933 12.75
	A13.4000933 13.4000933 0 0 0 11.5 -0.6500933
	A13.4000933 13.4000933 0 0 0 -1.9000933 12.75
	A13.4000933 13.4000933 0 0 0 11.5 26.1500933
	A13.4000933 13.4000933 0 0 0 24.9000933 12.75
	C24.9000933 9.4771177 23.7010242 14.6237198 21 18${ REVERSED_DRAW_CURVES }`;

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
			const line = moving.current;
			if (
				reducedMotion ||
				! rest ||
				! line ||
				typeof line.animate !== 'function' ||
				animations.current.some( ( animation ) => animation.playState === 'running' )
			)
				return;
			const duration = getMotionDuration( 'reveal' ) * 2;
			if ( ! duration ) return;
			animations.current.forEach( ( animation ) => animation.cancel() );
			const length = rest.getTotalLength();
			const distance = line.getTotalLength();
			// The full-route gap keeps a single fixed-length stroke visible.
			line.setAttribute( 'stroke-dasharray', `${ length } ${ distance }` );
			const easing = getComputedStyle( document.documentElement )
				.getPropertyValue( '--motion-ease-layout' )
				.trim();
			const options = { duration, easing };
			animations.current = [
				rest.animate( [ { opacity: 0 }, { opacity: 0 } ], options ),
				line.animate(
					[
						{ opacity: 1, strokeDashoffset: '0px' },
						{ opacity: 1, strokeDashoffset: `${ length - distance }px` },
					],
					options
				),
			];
			const startTime = document.timeline.currentTime;
			animations.current.forEach( ( animation ) => ( animation.startTime = startTime ) );
		},
	} ) );
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			overflow="visible"
			aria-hidden="true"
			{ ...props }
		>
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
