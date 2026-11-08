import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import { getMotionDuration } from '@/lib/theme';

const DRAW_PATH =
	'M3 8.5C8 3.5 15 1 17.5 4C20 7 4.5 14.75 7 17C9.5 19.25 17.25 8.25 20 10.5C22.25 12.5 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18';
const REVERSED_DRAW_CURVES =
	'C20 19.25 18 21.25 16.5 20.5C13.5 19 22.25 12.5 20 10.5C17.25 8.25 9.5 19.25 7 17C4.5 14.75 20 7 17.5 4C15 1 8 3.5 3 8.5';
const TRAVEL_PATH = `M21 18${ REVERSED_DRAW_CURVES }
	C2.5521657 8.9478343 2.1203759 9.4157241 1.7093009 9.9015140
	C0.4760759 11.3588835 -0.5707154 12.9773528 -0.7643362 15.0026503
	C-0.9579570 17.0279477 -0.2984073 19.4600734 2.1784349 21.3542855
	C4.6552770 23.2484975 8.9494118 24.6047961 10.1065690 24.9225808
	C11.1416767 25.2068476 12.2069546 25.3577524 13.2562617 25.3616285
	C16.4041828 25.3732571 19.4083656 24.0616285 21.5323432 21.7391476
	C23.6563208 19.4166667 24.9000933 16.0833333 24.9000933 12.7500000
	C24.9000933 9.4166667 23.6563208 6.0833333 21.3740099 3.7525191
	C19.0916989 1.4217048 15.7708495 0.0934096 12.6895950 0.1800381
	C9.6083406 0.2666667 6.7666811 1.7682189 4.7354293 4.1323665
	C2.7041775 6.4965141 1.4833333 9.7232571 1.4166667 12.9583333
	C1.3500000 16.1934096 2.4375108 19.4368192 4.6270960 21.7259668
	C6.8166811 24.0151144 10.1083406 25.3500000 13.2562617 25.3616285
	C16.4041828 25.3732571 19.4083656 24.0616285 21.5323432 21.7391476
	C23.6563208 19.4166667 24.9000933 16.0833333 24.9000933 12.7500000
	C24.9000933 9.4771177 23.7010242 14.6237198 21.0000000 18.0000000${ REVERSED_DRAW_CURVES }`;

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
