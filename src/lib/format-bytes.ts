export function formatBytes( bytes: number ): string {
	if ( bytes === 0 ) return '0 B';

	const mb = bytes / ( 1024 * 1024 );
	if ( mb < 1024 ) {
		return `${ mb.toFixed( 2 ) } MB`;
	}

	const gb = mb / 1024;
	return `${ gb.toFixed( 2 ) } GB`;
} 