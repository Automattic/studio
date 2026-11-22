import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 16 7 18.25C9.5 20.5 17.25 9.5 20 11.75C22.25 13.75 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const REVERSED_DRAW_CURVES =
	'C20 19.25 18 21.25 16.5 20.5C13.5 19 22.25 13.75 20 11.75C17.25 9.5 9.5 20.5 7 18.25C4.5 16 20 7 17.5 4C15 1 8 3.5 3 8.5';
const TRAVEL_PATH = `M21 18${ REVERSED_DRAW_CURVES }
	C2.934 8.566 2.868 8.632 2.803 8.699
	C1.737 9.791 0.767 10.998 0.381 12.765
	C-0.006 14.532 0.191 16.86 2.126 18.965
	C4.061 21.07 7.734 22.952 10.258 23.63
	C11.21 23.886 12.19 24.022 13.156 24.025
	C16.052 24.036 18.816 22.855 20.77 20.765
	C22.724 18.675 23.868 15.675 23.868 12.675
	C23.868 11.128 23.564 14.795 21.0 18.0${ REVERSED_DRAW_CURVES }`;

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
			const duration = getMotionDuration( 'reveal' ) * 1.5;
			if ( ! duration ) return;
			animations.current.forEach( ( animation ) => animation.cancel() );
			const length = rest.getTotalLength();
			const distance = line.getTotalLength();
			// The full-route gap keeps a single fixed-length stroke visible.
			line.setAttribute( 'stroke-dasharray', `${ length } ${ distance }` );
			const options = { duration, easing: 'ease' };
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
