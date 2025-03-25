import { useCallback, useEffect, useState } from 'react';
import { useWindowListener } from 'src/hooks/use-window-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

/**
 * Custom hook that checks if the Studio CA certificate is trusted on the system
 * @returns A boolean indicating if the certificate is trusted
 */
export function useCertificateTrust(): boolean {
	const isMounted = useRef( true );
	const [ isTrusted, setIsTrusted ] = useState< boolean >( false );

	const checkCertificateTrust = useCallback( () => {
		// If the certificate is already trusted, don't check it again
		if ( isTrusted ) {
			return;
		}

		getIpcApi()
			.isCATrusted()
			.then( ( trusted ) => {
				setIsTrusted( trusted );
			} )
			.catch( ( error ) => {
				console.error( 'Failed to check certificate trust:', error );
			} );
	}, [ isTrusted ] );

	useWindowListener( 'focus', checkCertificateTrust );

	useEffect( () => {
		checkCertificateTrust();
	}, [ checkCertificateTrust ] );

	return isTrusted;
}
