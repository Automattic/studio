import { createApi, TypedUseQuery, TypedUseMutation } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { WPCOM } from 'wpcom/types';
import { z } from 'zod';
import { DAY_MS } from '@studio/common/constants';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { withOfflineCheck, withOfflineCheckMutation } from 'src/stores/utils/with-offline-check';
import type { BaseQueryFn, FetchBaseQueryError } from '@reduxjs/toolkit/query';

const welcomeMessageSchema = z.object( {
	messages: z.array( z.string() ),
	example_prompts: z.array( z.string() ),
} );

export const assistantQuotaSchema = z
	.object( {
		max_quota: z.number(),
		quota_reset_date: z.string().datetime( { offset: true } ),
		remaining_quota: z.number(),
	} )
	.transform( ( data ) => {
		const promptCount = data.max_quota - data.remaining_quota;
		const daysUntilReset = calculateDaysUntilQuotaReset( data.quota_reset_date );

		return {
			daysUntilReset,
			promptCount,
			promptLimit: data.max_quota,
			quotaResetDate: data.quota_reset_date,
			remainingQuota: data.remaining_quota,
			userCanSendMessage: promptCount < data.max_quota,
		};
	} );

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

const blueprintSchema = z.object( {
	slug: z.string(),
	title: z.string(),
	excerpt: z.string(),
	image: z.string(),
	playground_url: z.string(),
	blueprint: z.record( z.string(), z.unknown() ),
} );

export type Blueprint = z.infer< typeof blueprintSchema >;

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

function calculateDaysUntilQuotaReset( quotaResetDate: string ): number {
	const resetDate = new Date( quotaResetDate );
	const currentDate = new Date();
	const timeDifference = resetDate.getTime() - currentDate.getTime();
	return Math.ceil( timeDifference / DAY_MS );
}

export const wpcomApi = createApi( {
	reducerPath: 'wpcomApi',
	baseQuery: wpcomBaseQuery,
	tagTypes: [ 'AssistantQuota', 'SnapshotUsage' ],
	endpoints: ( builder ) => ( {
		getWelcomeMessages: builder.query< z.infer< typeof welcomeMessageSchema >, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, welcomeMessageSchema ),
			keepUnusedDataFor: 60 * 60,
		} ),
		getAssistantQuota: builder.query< z.infer< typeof assistantQuotaSchema >, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/quota',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, assistantQuotaSchema ),
			keepUnusedDataFor: 60 * 60,
			providesTags: [ 'AssistantQuota' ],
		} ),
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
		deleteAllSnapshots: builder.mutation< void, void >( {
			query: () => ( {
				path: '/jurassic-ninja/delete/all',
				apiNamespace: 'wpcom/v2',
				method: 'POST',
			} ),
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

export const useGetWelcomeMessages = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetWelcomeMessagesQuery )
);

export const useGetAssistantQuota = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetAssistantQuotaQuery )
);

export const useGetSnapshotUsage = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetSnapshotUsageQuery )
);

export const useGetSnapshotStatus = withWpcomClientCheck(
	withOfflineCheck( wpcomApi.useGetSnapshotStatusQuery )
);

export const useDeleteAllSnapshots = withWpcomClientCheckMutation(
	withOfflineCheckMutation( wpcomApi.useDeleteAllSnapshotsMutation )
);

// Blueprints use the public API and don't require authentication
export const useGetBlueprints = withOfflineCheck( wpcomPublicApi.useGetBlueprintsQuery );
