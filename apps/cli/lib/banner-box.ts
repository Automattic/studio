type ChalkColor = ( text: string ) => string;

/**
 * Renders lines inside a rounded Unicode box, returning a multi-line string
 * with a blank line before and after the box.
 * Strips ANSI codes when measuring so colored lines pad correctly.
 */
export function renderBannerBox( lines: string[], borderColor: ChalkColor ): string {
	// Calculate box width based on longest line (strip ANSI for measurement)
	// eslint-disable-next-line no-control-regex
	const ansiPattern = new RegExp( '\u001B\\[[0-9;]*m', 'g' );
	const stripAnsi = ( str: string ) => str.replace( ansiPattern, '' );
	const maxLen = Math.max( 0, ...lines.map( ( l ) => stripAnsi( l ).length ) );
	const padding = 2;
	const innerWidth = maxLen + padding * 2;

	const top = borderColor( `╭${ '─'.repeat( innerWidth ) }╮` );
	const bottom = borderColor( `╰${ '─'.repeat( innerWidth ) }╯` );
	const side = borderColor( '│' );

	const paddedLines = lines.map( ( line ) => {
		const visibleLen = stripAnsi( line ).length;
		const rightPad = Math.max( 0, innerWidth - padding - visibleLen );
		return `${ side }${ ' '.repeat( padding ) }${ line }${ ' '.repeat( rightPad ) }${ side }`;
	} );

	return [ '', top, ...paddedLines, bottom, '' ].join( '\n' );
}
