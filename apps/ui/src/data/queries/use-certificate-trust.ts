import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const CERTIFICATE_TRUST_QUERY_KEY = [ 'certificate-trust' ] as const;

export function useCertificateTrust() {
	const connector = useConnector();
	return useQuery( {
		queryKey: CERTIFICATE_TRUST_QUERY_KEY,
		queryFn: () => connector.isCertificateTrusted(),
		staleTime: 60 * 1000,
		retry: 1,
	} );
}

export function useTrustCertificate() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return {
		mutate: async () => {
			await connector.trustCertificate();
			await queryClient.invalidateQueries( { queryKey: CERTIFICATE_TRUST_QUERY_KEY } );
		},
	};
}
