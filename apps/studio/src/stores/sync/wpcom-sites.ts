import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import {
	isStagingSiteResponse,
	transformSingleSiteResponse,
	transformSitesResponse,
} from '@studio/common/lib/sync/transform-sites';
import { sitesEndpointSiteSchema, sitesEndpointResponseSchema } from '@studio/common/types/sync';
import { z } from 'zod';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { reconcileConnectedSites } from 'src/modules/sync/lib/reconcile-connected-sites';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { SyncSite } from '@studio/common/types/sync';

const SITE_FIELDS = [
	'name',
	'ID',
	'URL',
	'plan',
	'capabilities',
	'is_wpcom_atomic',
	'options',
	'jetpack',
	'is_deleted',
	'is_a8c',
	'is_wpcom_staging_site',
	'hosting_provider_guess',
	'environment_type',
	'icon',
].join( ',' );

const activeWpcomThemeResponseSchema = z
	.object( {
		id: z.string().optional(),
		name: z.string().optional(),
		screenshot: z.string().nullable().optional(),
		is_block_theme: z.boolean().optional(),
		block_theme: z.boolean().optional(),
		blockTheme: z.boolean().optional(),
		supports_menus: z.boolean().optional(),
		supports_widgets: z.boolean().optional(),
	} )
	.passthrough()
	.transform( ( theme ) => ( {
		id: theme.id,
		name: theme.name,
		screenshotUrl: theme.screenshot || undefined,
		isBlockTheme: theme.is_block_theme ?? theme.block_theme ?? theme.blockTheme,
		supportsMenus: theme.supports_menus,
		supportsWidgets: theme.supports_widgets,
	} ) );

export type WpcomActiveTheme = z.infer< typeof activeWpcomThemeResponseSchema >;

const wpcomSiteSettingsResponseSchema = z
	.object( {
		ID: z.number().optional(),
		name: z.string().optional(),
		description: z.string().optional(),
		URL: z.string().optional(),
		lang: z.string().optional(),
		locale_variant: z.string().nullable().optional(),
		settings: z.record( z.string(), z.unknown() ).optional(),
	} )
	.passthrough()
	.transform( ( response ) => ( {
		id: response.ID,
		name: response.name,
		description: response.description,
		url: response.URL,
		lang: response.lang,
		localeVariant: response.locale_variant ?? undefined,
		settings: response.settings ?? {},
	} ) );

export type WpcomSiteSettings = z.infer< typeof wpcomSiteSettingsResponseSchema >;

export const wpcomSitesApi = createApi( {
	reducerPath: 'wpcomSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'WpComSites' ],
	endpoints: ( builder ) => ( {
		getSingleWpComSite: builder.query< SyncSite, { siteId: number; userId?: number } >( {
			queryFn: async ( { siteId } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const response = await wpcomClient.req.get(
						{
							apiNamespace: 'rest/v1.1',
							path: `/sites/${ siteId }`,
						},
						{
							fields: SITE_FIELDS,
							options: 'created_at,wpcom_staging_blog_ids',
						}
					);

					const parsedSite = sitesEndpointSiteSchema.parse( response );

					const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

					// Single-site responses do not include the parent site's staging ID list.
					const isStaging = isStagingSiteResponse( parsedSite );

					const syncSupport = getSyncSupport(
						parsedSite,
						allConnectedSites.map( ( { id } ) => id )
					);

					const syncSite = transformSingleSiteResponse( parsedSite, syncSupport, isStaging, {
						stagingSiteIds: isStaging ? undefined : parsedSite.options?.wpcom_staging_blog_ids,
					} );

					return { data: syncSite };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			providesTags: ( _result, _error, arg ) => [
				{ type: 'WpComSites', userId: arg.userId },
				{ type: 'WpComSites', id: arg.siteId },
			],
		} ),
		getWpComSites: builder.query<
			{ sites: SyncSite[]; total: number; page: number; perPage: number },
			{
				connectedSiteIds?: number[];
				userId?: number;
				page?: number;
				perPage?: number;
				search?: string;
			}
		>( {
			queryFn: async ( { connectedSiteIds, page = 1, perPage = 20, search } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

					const queryParams: Record< string, string | number | boolean > = {
						fields: SITE_FIELDS,
						filter: 'atomic,wpcom',
						options: 'created_at,wpcom_staging_blog_ids,software_version',
						site_activity: 'active',
						include_a8c_owned: false,
						page,
						per_page: perPage,
					};
					if ( search ) {
						queryParams.search = search;
					}

					const response = await wpcomClient.req.get(
						{
							apiNamespace: 'rest/v1.3',
							path: `/me/sites`,
						},
						queryParams
					);

					const parsedResponse = sitesEndpointResponseSchema.parse( response );

					const sentryOptions = { onParseError: Sentry.captureException };

					// Only reconcile on the first page without search
					if ( page === 1 && ! search ) {
						const connectedIds = allConnectedSites.map( ( { id } ) => id );
						const syncSitesForReconciliation = transformSitesResponse( parsedResponse.sites, {
							connectedSiteIds: connectedIds,
							...sentryOptions,
						} );

						// Connected sites that weren't on page 1 need explicit verification
						// before we'd mark them deleted — otherwise pagination would flag
						// any connected site past the first page as gone.
						const fetchedIds = new Set(
							parsedResponse.sites
								.map( ( s ) => sitesEndpointSiteSchema.safeParse( s ).data?.ID )
								.filter( ( id ): id is number => typeof id === 'number' )
						);
						const missingConnectedIds = connectedIds.filter( ( id ) => ! fetchedIds.has( id ) );

						const verifiedDeletedIds = new Set< number >();
						const supplementalSites: SyncSite[] = [];

						await Promise.all(
							missingConnectedIds.map( async ( siteId ) => {
								try {
									const singleResponse = await wpcomClient.req.get(
										{
											apiNamespace: 'rest/v1.1',
											path: `/sites/${ siteId }`,
										},
										{
											fields: SITE_FIELDS,
											options: 'created_at,wpcom_staging_blog_ids',
										}
									);
									const parsed = sitesEndpointSiteSchema.parse( singleResponse );
									const syncSupport = getSyncSupport( parsed, connectedIds );
									const isStaging = isStagingSiteResponse( parsed );
									supplementalSites.push(
										transformSingleSiteResponse( parsed, syncSupport, isStaging, {
											stagingSiteIds: isStaging
												? undefined
												: parsed.options?.wpcom_staging_blog_ids,
										} )
									);
								} catch ( error ) {
									const status = ( error as { status?: number } )?.status;
									if ( status === 404 ) {
										verifiedDeletedIds.add( siteId );
									}
									// For any other error (auth, network, 5xx) leave the site's
									// current state untouched — it'll be re-checked next time.
								}
							} )
						);

						const { updatedConnectedSites } = reconcileConnectedSites(
							allConnectedSites,
							[ ...syncSitesForReconciliation, ...supplementalSites ],
							verifiedDeletedIds
						);
						await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );
					}

					const syncSites = transformSitesResponse( parsedResponse.sites, {
						connectedSiteIds,
						...sentryOptions,
					} );

					return {
						data: {
							sites: syncSites,
							total: parsedResponse.total ?? syncSites.length,
							page: parsedResponse.page ?? page,
							perPage: parsedResponse.per_page ?? perPage,
						},
					};
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			providesTags: ( _result, _error, arg ) => [ { type: 'WpComSites', userId: arg.userId } ],
		} ),
		getPhpVersion: builder.query< string, { siteId: number; userId?: number } >( {
			queryFn: async ( { siteId } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const response = await wpcomClient.req.get( {
						apiNamespace: 'wpcom/v2',
						path: `/sites/${ siteId }/hosting/php-version`,
					} );

					return { data: z.string().parse( response ) };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			keepUnusedDataFor: 300,
			providesTags: ( _result, _error, arg ) => [
				{ type: 'WpComSites', userId: arg.userId },
				{ type: 'WpComSites', id: arg.siteId },
			],
		} ),
		getActiveWpcomTheme: builder.query< WpcomActiveTheme, { siteId: number; userId?: number } >( {
			queryFn: async ( { siteId } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const response = await wpcomClient.req.get( {
						apiNamespace: 'rest/v1',
						path: `/sites/${ siteId }/themes/mine`,
					} );

					return { data: activeWpcomThemeResponseSchema.parse( response ) };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			keepUnusedDataFor: 300,
			providesTags: ( _result, _error, arg ) => [
				{ type: 'WpComSites', userId: arg.userId },
				{ type: 'WpComSites', id: arg.siteId },
			],
		} ),
		getWpcomSiteSettings: builder.query< WpcomSiteSettings, { siteId: number; userId?: number } >( {
			queryFn: async ( { siteId } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const response = await wpcomClient.req.get( {
						apiNamespace: 'rest/v1.1',
						path: `/sites/${ siteId }/settings`,
					} );

					return { data: wpcomSiteSettingsResponseSchema.parse( response ) };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			keepUnusedDataFor: 300,
			providesTags: ( _result, _error, arg ) => [
				{ type: 'WpComSites', userId: arg.userId },
				{ type: 'WpComSites', id: arg.siteId },
			],
		} ),
	} ),
} );

const {
	useGetWpComSitesQuery: useGetWpComSitesQueryBase,
	useGetPhpVersionQuery: useGetPhpVersionQueryBase,
	useGetActiveWpcomThemeQuery: useGetActiveWpcomThemeQueryBase,
	useGetWpcomSiteSettingsQuery: useGetWpcomSiteSettingsQueryBase,
} = wpcomSitesApi;

// Wrap the query hook with offline check
// Authentication is already handled in queryFn which checks wpcomClient
export const useGetWpComSitesQuery = withOfflineCheck( useGetWpComSitesQueryBase );
export const useGetPhpVersionQuery = withOfflineCheck( useGetPhpVersionQueryBase );
export const useGetActiveWpcomThemeQuery = withOfflineCheck( useGetActiveWpcomThemeQueryBase );
export const useGetWpcomSiteSettingsQuery = withOfflineCheck( useGetWpcomSiteSettingsQueryBase );
