import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 16 7 18.25C9.5 20.5 17.25 9.5 20 11.75C22.25 13.75 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const REVERSED_DRAW_CURVES =
	'C20 19.25 18 21.25 16.5 20.5C13.5 19 22.25 13.75 20 11.75C17.25 9.5 9.5 20.5 7 18.25C4.5 16 20 7 17.5 4C15 1 8 3.5 3 8.5';
const TRAVEL_PATH = `M21 18${ REVERSED_DRAW_CURVES }
	C2.9340034 8.5659966 2.8683552 8.6324288 2.8030704 8.6992897
	C1.7367520 9.7913501 0.7673786 10.9977667 0.3808701 12.7648756
	C-0.0056383 14.5319846 0.1907182 16.8597860 2.1256786 18.9648598
	C4.0606390 21.0699336 7.7342033 22.9522798 10.2580435 23.6303227
	C11.2103425 23.8861629 12.1903983 24.0219771 13.1557607 24.0254657
	C16.0518482 24.0359314 18.8156964 22.8554657 20.7697558 20.7652328
	C22.7238152 18.6750000 23.8680858 15.6750000 23.8680858 12.6750000
	C23.8680858 11.1281647 23.5638752 14.7951560 21.0000000 18.0000000${ REVERSED_DRAW_CURVES }`;

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
