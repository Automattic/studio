export interface PreviewDot {
	x: number;
	y: number;
	dx: number;
	dy: number;
	distance: number;
	// 0 at the edges, so motion fades out before it reaches them.
	edge: number;
}

export const SELECTION_WAVE_DURATION = 700;

// How brightly a dot catches the wave that sweeps down the field after its
// site is picked, `elapsed` ms in: 0 outside it, up to 1 at its crest.
export function getSelectionWave(
	dot: PreviewDot,
	{ elapsed, height, centerX }: { elapsed: number; height: number; centerX: number }
) {
	if ( elapsed < 0 || elapsed >= SELECTION_WAVE_DURATION ) {
		return 0;
	}
	const arrival =
		( dot.y / Math.max( 1, height ) ) * 0.64 +
		( 1 - Math.min( 1, Math.abs( dot.x - centerX ) / Math.max( 1, centerX ) ) ** 2 ) * 0.12;
	const phase = ( elapsed / SELECTION_WAVE_DURATION - arrival ) / 0.24;
	return phase > 0 && phase < 1 ? Math.sin( phase * Math.PI ) ** 2 : 0;
}

export function createPreviewDots( width: number, height: number ): PreviewDot[] {
	const centerX = width / 2;
	const centerY = height / 2;
	const spacing = Math.max( 26, Math.sqrt( ( width * height ) / 1600 ) );
	const inset = Math.min( 18, width / 2, height / 2 );
	const columns = Math.max( 1, Math.round( ( width - inset * 2 ) / spacing ) + 1 );
	const rows = Math.max( 1, Math.round( ( height - inset * 2 ) / spacing ) + 1 );
	const dots: PreviewDot[] = [];
	for ( let row = 0; row < rows; row++ ) {
		for ( let column = 0; column < columns; column++ ) {
			const x =
				columns === 1 ? centerX : inset + ( column * ( width - inset * 2 ) ) / ( columns - 1 );
			const y = rows === 1 ? centerY : inset + ( row * ( height - inset * 2 ) ) / ( rows - 1 );
			const distance = Math.hypot( x - centerX, y - centerY );
			dots.push( {
				x,
				y,
				distance,
				dx: ( x - centerX ) / ( distance || 1 ),
				dy: ( y - centerY ) / ( distance || 1 ),
				edge: Math.min(
					1,
					Math.max(
						0,
						Math.min( x - inset, width - inset - x, y - inset, height - inset - y ) / 80
					)
				),
			} );
		}
	}
	return dots;
}

// Where a dot sits at `time` (ms) when the field moves by `amount` (0–1): a
// ripple out from the center plus a slow swirl. With `logoAmount`, dots fade
// out of the middle to leave room for the logo; without it, dots near the
// middle move less so the field doesn't open a hole there.
export function getPreviewDotFrame(
	dot: PreviewDot,
	{
		time,
		amount,
		centerX,
		centerY,
		logoAmount,
	}: { time: number; amount: number; centerX: number; centerY: number; logoAmount: number }
) {
	const wave = Math.sin( dot.distance / 85 - time / 650 );
	const centerMovement = Math.min( 1, dot.distance / 96 );
	const movement = amount * dot.edge * ( centerMovement + ( 1 - centerMovement ) * logoAmount );
	const ripple = wave * 26 * movement;
	const swirl = Math.sin( time / 1100 - dot.distance / 180 ) * 52 * movement;
	const x = dot.x + dot.dx * ripple - dot.dy * swirl;
	const y = dot.y + dot.dy * ripple + dot.dx * swirl;
	const clearance =
		1 -
		logoAmount *
			( 1 - Math.max( 0, Math.min( 1, ( Math.hypot( x - centerX, y - centerY ) - 36 ) / 24 ) ) );
	const opacity = clearance * clearance * ( 3 - 2 * clearance );
	return { x, y, opacity };
}
