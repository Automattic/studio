import { useCallback } from 'react';

export function useSha256() {
	const sha256 = useCallback( ( data: string ) => {
		return crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( data ) ).then( ( digest ) => {
			return Array.from( new Uint8Array( digest ) )
				.map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) )
				.join( '' );
		} );
	}, [] );

	return sha256;
}
