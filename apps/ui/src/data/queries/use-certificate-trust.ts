import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { openStudioLogsAction, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';

const CERTIFICATE_TRUST_QUERY_KEY = [ 'certificate-trust' ] as const;

// Rechecked on focus, so trusting the certificate outside Studio (Keychain
// Access on macOS) shows up when the user comes back.
export function useCertificateTrust() {
	const connector = useConnector();
	return useQuery( {
		queryKey: CERTIFICATE_TRUST_QUERY_KEY,
		queryFn: () => connector.isCertificateTrusted(),
		meta: { persist: false },
	} );
}

export function useTrustCertificate() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.trustCertificate(),
		onError: () =>
			toast.error( __( "Couldn't trust Studio's certificate" ), {
				action: openStudioLogsAction( connector ),
			} ),
		onSettled: () => queryClient.invalidateQueries( { queryKey: CERTIFICATE_TRUST_QUERY_KEY } ),
	} );
}
