import { useCallback } from 'react';
import { useWindowListener } from 'src/hooks/use-window-listener';
import { useCheckCertificateTrustQuery } from 'src/stores/certificate-trust-api';

/**
 * Custom hook that checks if the Studio CA certificate is trusted on the system
 * @returns A boolean indicating if the certificate is trusted
 */
export function useCertificateTrust(): boolean {
	const { data: isTrusted = false, refetch: checkCertificateTrust } =
		useCheckCertificateTrustQuery();

	const checkTrust = useCallback( () => {
		if ( ! isTrusted ) {
			void checkCertificateTrust();
		}
	}, [ isTrusted, checkCertificateTrust ] );

	useWindowListener( 'focus', checkTrust );

	return true;
}
