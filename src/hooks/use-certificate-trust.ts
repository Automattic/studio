import { useCallback, useEffect, useRef, useState } from 'react';
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
		getIpcApi()
			.isCATrusted()
			.then( ( trusted ) => {
				if ( isMounted.current ) {
					setIsTrusted( trusted );
				}
			} );
	}, [ setIsTrusted ] );

	useWindowListener( 'focus', checkCertificateTrust );

	useEffect( () => {
		isMounted.current = true;
		checkCertificateTrust();
		return () => {
			isMounted.current = false;
		};
	}, [ checkCertificateTrust ] );

	return isTrusted;
}
