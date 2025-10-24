export function formatBytes( bytes: number ): string {
	if ( ! Number.isFinite( bytes ) || bytes <= 0 ) {
		return '0 Bytes';
	}
	const k = 1024;
	const units = [ 'Bytes', 'KB', 'MB', 'GB', 'TB' ] as const;
	const i = Math.min( Math.floor( Math.log( bytes ) / Math.log( k ) ), units.length - 1 );
	const value = bytes / Math.pow( k, i );
	return `${ Math.round( value * 100 ) / 100 } ${ units[ i ] }`;
}
