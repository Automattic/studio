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
					const errorMessage =
						error instanceof Error ? error.message : 'Failed to check certificate trust';
					return {
						error: { status: 500, data: errorMessage },
					};
				}
			},
			providesTags: [ 'CertificateTrust' ],
		} ),
		getLinuxBrowserCertSupportStatus: builder.query< { firefoxDetected: boolean }, void >( {
			queryFn: async () => {
				try {
					const status = await getIpcApi().getLinuxBrowserCertSupportStatus();
					return { data: status };
				} catch ( error ) {
					console.error( 'Failed to get Linux browser cert support status:', error );
					return { data: { firefoxDetected: false } };
				}
			},
			providesTags: [ 'CertificateTrust' ],
		} ),
	} ),
} );

export const { useCheckCertificateTrustQuery, useGetLinuxBrowserCertSupportStatusQuery } =
	certificateTrustApi;
