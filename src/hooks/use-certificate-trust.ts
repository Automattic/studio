import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

/**
 * Custom hook that checks if the Studio CA certificate is trusted on the system
 * @returns A boolean indicating if the certificate is trusted
 */
export function useCertificateTrust(): boolean {
	const [ isTrusted, setIsTrusted ] = useState< boolean >( false );

	useEffect( () => {
		let isMounted = true;

		const checkCertificateTrust = async () => {
			try {
				const trusted = await getIpcApi().isCATrusted();
				if ( isMounted ) {
					setIsTrusted( trusted );
				}
			} catch ( error ) {
				console.error( 'Error checking certificate trust status:', error );
			}
		};

		checkCertificateTrust();

		return () => {
			isMounted = false;
		};
	}, [] );

	return isTrusted;
}
