import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const certificateTrustApi = createApi( {
	reducerPath: 'certificateTrustApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'CertificateTrust' ],
	refetchOnFocus: true,
	endpoints: ( builder ) => ( {
		checkCertificateTrust: builder.query< boolean, void >( {
			queryFn: async () => {
				try {
					const isTrusted = await getIpcApi().isCATrusted();
					return { data: isTrusted };
				} catch ( error ) {
					console.error( 'Failed to check certificate trust:', error );
					return { data: false };
				}
			},
			providesTags: [ 'CertificateTrust' ],
		} ),
	} ),
} );

export const { useCheckCertificateTrustQuery } = certificateTrustApi;
