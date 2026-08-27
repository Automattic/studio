import { createApi, TypedUseQuery, TypedUseMutation } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { studioAssistantQuotaSchema } from '@studio/common/lib/studio-assistant-quota';
import {
	parseStudioAssistantTopUpPricing,
	type StudioAssistantTopUpPricing,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { blueprintSchema, type Blueprint } from '@studio/common/lib/studio-blueprints-api';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { withOfflineCheck, withOfflineCheckMutation } from 'src/stores/utils/with-offline-check';
import type { BaseQueryFn, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { WPCOM } from 'wpcom/types';

const snapshotUsageSchema = z
	.object( {
		site_count: z.number(),
		site_limit: z.number(),
		site_creation_blocked: z.boolean(),
	} )
	.transform( ( data ) => ( {
		siteCount: data.site_count,
		siteLimit: data.site_limit,
		siteCreationBlocked: data.site_creation_blocked,
	} ) );

const snapshotStatusSchema = z
	.object( {
		domain_name: z.string(),
		atomic_site_id: z.number(),
		status: z.string(),
		is_deleted: z.string(),
	} )
	.transform( ( data ) => ( {
		domainName: data.domain_name,
		atomicSiteId: data.atomic_site_id,
		status: data.status,
		isDeleted: data.is_deleted === '1',
	} ) );

export type { Blueprint };

let wpcomClient: WPCOM | undefined;
const publicWpcomClient = wpcomFactory( wpcomXhrRequest );

export const setWpcomClient = ( client: WPCOM | undefined ) => {
	wpcomClient = client;
};

export const getWpcomClient = (): WPCOM | undefined => {
	return wpcomClient;
};

const wpcomBaseQuery: BaseQueryFn<
	{ path: string; apiNamespace?: string },
	unknown,
	FetchBaseQueryError
> = async ( args ) => {
	try {
		const response = await wpcomClient!.req.get( args );
		return { data: response };
	} catch ( error ) {
		return {
			error: {
				status: 500,
				data: error,
			},
		};
	}
};

// Base query for public endpoints that don't require authentication
const wpcomPublicBaseQuery: BaseQueryFn<
	{ path: string; apiNamespace?: string },
	unknown,
	FetchBaseQueryError
> = async ( args ) => {
	try {
		const client = publicWpcomClient;
		const response = await client.req.get( args );
		return { data: response };
	} catch ( error ) {
		return {
			error: {
				status: 500,
				data: error,
			},
		};
	}
};

function parseResponse< TSchema extends z.ZodType >(
	response: unknown,
	schema: TSchema
): z.infer< TSchema > {
	try {
		return schema.parse( response );
	} catch ( error ) {
		Sentry.captureException( error );
		throw error;
	}
}

export const wpcomApi = createApi( {
	reducerPath: 'wpcomApi',
	baseQuery: wpcomBaseQuery,
	tagTypes: [ 'SnapshotUsage', 'StudioAssistantQuota' ],
	endpoints: ( builder ) => ( {
		getSnapshotUsage: builder.query< z.infer< typeof snapshotUsageSchema >, void >( {
			query: () => ( {
				path: '/jurassic-ninja/usage',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, snapshotUsageSchema ),
			keepUnusedDataFor: 60 * 60,
			providesTags: [ 'SnapshotUsage' ],
		} ),
		getSnapshotStatus: builder.query< z.infer< typeof snapshotStatusSchema >, number >( {
			query: ( siteId ) => ( {
				path: `/jurassic-ninja/status?site_id=${ siteId }`,
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, snapshotStatusSchema ),
			keepUnusedDataFor: 60 * 60,
		} ),
		getStudioAssistantQuota: builder.query< z.infer< typeof studioAssistantQuotaSchema >, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/quota',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) =>
				parseResponse( response, studioAssistantQuotaSchema ),
			keepUnusedDataFor: 60 * 60,
			providesTags: [ 'StudioAssistantQuota' ],
		} ),
		getStudioAssistantTopUpPricing: builder.query< StudioAssistantTopUpPricing | null, void >( {
			queryFn: async ( _arg, _api, _extraOptions, baseQuery ) => {
				const result = await baseQuery( {
					path: '/studio-app/ai-assistant/top-up-pricing',
					apiNamespace: 'wpcom/v2',
				} );
				// Pricing is a nicety, not a gate: a failed or unexpected
				// response resolves `null` and the caller offers the single
				// fixed top-up instead of erroring the whole notice.
				return { data: parseStudioAssistantTopUpPricing( result.error ? null : result.data ) };
			},
			keepUnusedDataFor: 60 * 60,
		} ),
		deleteAllSnapshots: builder.mutation< void, void >( {
			queryFn: async () => {
				await getIpcApi().deleteAllSnapshots();
				return { data: undefined };
			},
			// We don't invalidate the `SnapshotUsage` tag because the API won't return the correct data
			// until we've waited a few seconds. `snapshot-slice.ts` handles the invalidation.
		} ),
	} ),
} );

// Public API for endpoints that don't require authentication
export const wpcomPublicApi = createApi( {
	reducerPath: 'wpcomPublicApi',
	baseQuery: wpcomPublicBaseQuery,
	tagTypes: [ 'Blueprints' ],
	endpoints: ( builder ) => ( {
		getBlueprints: builder.query<
			{ blueprints: z.infer< typeof blueprintSchema >[]; total: number },
			{ locale?: string }
		>( {
			query: ( { locale } = {} ) => ( {
				path: `/studio-app/blueprints${ locale ? `?locale=${ locale }` : '' }`,
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => {
				if ( ! response || typeof response !== 'object' ) {
					throw new Error( 'Invalid response format' );
				}

				const responseObj = response as Record< string, unknown >;
				const blueprints = responseObj.blueprints;
				const total = responseObj.total;

				if ( typeof total !== 'number' ) {
					throw new Error( 'Invalid total count in response' );
				}

				if ( ! Array.isArray( blueprints ) ) {
					throw new Error( 'Invalid blueprints array in response' );
				}

				// Filter out invalid blueprint items to avoid failing the request
				const validBlueprints: z.infer< typeof blueprintSchema >[] = [];

				for ( const blueprint of blueprints ) {
					try {
						const validatedBlueprint = blueprintSchema.parse( blueprint );
						validBlueprints.push( validatedBlueprint );
					} catch ( error ) {
						console.warn( 'Invalid blueprint item filtered out:', blueprint, error );
					}
				}

				return {
					blueprints: validBlueprints,
					total: total,
				};
			},
			keepUnusedDataFor: 60 * 60,
			providesTags: [ 'Blueprints' ],
		} ),
	} ),
} );

function withWpcomClientCheck< TResult, TArg >(
	useQueryHook: TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery >
): TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery > {
	return ( arg, options = {} ) => {
		return useQueryHook( arg, {
			...options,
			skip: ! wpcomClient || options?.skip,
		} );
	};
}

function withWpcomClientCheckMutation< TResult, TArg >(
	useMutationHook: TypedUseMutation< TResult, TArg, typeof wpcomBaseQuery >
): TypedUseMutation< TResult, TArg, typeof wpcomBaseQuery > {
	return ( options = {} ) => {
		const [ trigger, result ] = useMutationHook( options );
		const wrappedTrigger = ( ( ...args: Parameters< typeof trigger > ) => {
			if ( ! wpcomClient ) {
				return Promise.reject( new Error( 'Not authenticated' ) ) as ReturnType< typeof trigger >;
			}
			return trigger( ...args );
		} ) as typeof trigger;
		return [ wrappedTrigger, result ] as const;
	};
}

export const useGetSnapshotUsage = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetSnapshotUsageQuery )
);

export const useGetSnapshotStatus = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetSnapshotStatusQuery )
);

export const useGetStudioAssistantQuota = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetStudioAssistantQuotaQuery )
);

export const useGetStudioAssistantTopUpPricing = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetStudioAssistantTopUpPricingQuery )
);

export const useDeleteAllSnapshots = withWpcomClientCheckMutation(
	withOfflineCheckMutation( wpcomApi.useDeleteAllSnapshotsMutation )
);

// Blueprints use the public API and don't require authentication
export const useGetBlueprints = withOfflineCheck( wpcomPublicApi.useGetBlueprintsQuery );
