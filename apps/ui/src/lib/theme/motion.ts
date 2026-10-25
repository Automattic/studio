/** A `--motion-duration-*` token in milliseconds, as resolved now (reduced motion shortens them). */
export function getMotionDuration( name: 'feedback' | 'surface' | 'layout' | 'reveal' ): number {
	const value = getComputedStyle( document.documentElement )
		.getPropertyValue( `--motion-duration-${ name }` )
		.trim();
	const duration = Number.parseFloat( value );
	return Number.isFinite( duration )
		? Math.max( 0, duration * ( value.endsWith( 'ms' ) ? 1 : 1000 ) )
		: 0;
}
