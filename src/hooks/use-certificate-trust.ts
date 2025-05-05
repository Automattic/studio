import { useCallback, useEffect } from 'react';
import { useWindowListener } from 'src/hooks/use-window-listener';
import { checkCertificateTrust, selectIsRootCATrusted } from 'src/store/slices/certificate-trust';
import { useAppDispatch, useRootSelector } from 'src/stores';

/**
 * Custom hook that checks if the Studio CA certificate is trusted on the system
 * @returns A boolean indicating if the certificate is trusted
 */
export function useCertificateTrust(): boolean {
	const dispatch = useAppDispatch();
	const isTrusted = useRootSelector( selectIsRootCATrusted );

	const checkTrust = useCallback( () => {
		if ( ! isTrusted ) {
			void dispatch( checkCertificateTrust() );
		}
	}, [ dispatch, isTrusted ] );

	useWindowListener( 'focus', checkTrust );

	useEffect( () => {
		checkTrust();
	}, [ checkTrust ] );

	return isTrusted;
}
