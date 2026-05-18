import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { SyncSite } from '@studio/common/types/sync';
import type { RootState } from 'src/stores';

export const STAGING_SYNC_OPTION_TOKENS = [
	'sqls',
	'contents',
	'themes',
	'plugins',
	'uploads',
	'roots',
] as const;
export type StagingSyncOption = ( typeof STAGING_SYNC_OPTION_TOKENS )[ number ];
export type StagingSyncPathOptions = {
	types: 'paths';
	include_paths: string[];
	exclude_paths?: string[];
};
export type StagingSyncOptions = StagingSyncOption[] | StagingSyncPathOptions;
export type StagingSyncDirection = 'push' | 'pull';
export type StagingSyncStatus =
	| 'idle'
	| 'started'
	| 'in-progress'
	| 'completed'
	| 'failed'
	| 'no-staging'
	| 'timed-out';

type StagingSyncApiError = {
	code?: string;
	message: string;
	status?: number;
};

export type StagingSyncState = {
	productionSiteId: number;
	stagingSiteId?: number;
	status: StagingSyncStatus;
	direction?: StagingSyncDirection;
	restoreId?: number;
	lastRestoreId?: number;
	startedAt?: string;
	completedAt?: string;
	updatedAt?: string;
	options?: StagingSyncOptions;
	error?: StagingSyncApiError;
};

type StagingSyncSliceState = {
	states: Record< number, StagingSyncState >;
};

const apiTimestampSchema = z
	.union( [ z.string(), z.number() ] )
	.nullable()
	.optional()
	.transform( ( value ) => {
		if ( value === undefined || value === null || value === '' ) {
			return undefined;
		}

		if ( typeof value === 'string' ) {
			return value;
		}

		const milliseconds = value > 10_000_000_000 ? value : value * 1000;
		const date = new Date( milliseconds );
		return Number.isNaN( date.getTime() ) ? String( value ) : date.toISOString();
	} );

const stagingSyncStateResponseSchema = z.object( {
	status: z.string(),
	staging_blog_id: z.number().optional(),
	restore_id: z.number().optional(),
	last_restore_id: z.number().optional(),
	production_blog_id: z.number(),
	started_at: apiTimestampSchema,
	completed_at: apiTimestampSchema,
	direction: z.enum( [ 'push', 'pull' ] ).optional(),
	options: z.unknown().optional(),
	updated_at: apiTimestampSchema,
} );

const successResponseSchema = z.object( {
	success: z.boolean(),
} );

const createdStagingSiteResponseSchema = z
	.object( {
		id: z.number(),
		name: z.string().optional(),
		url: z.string().optional(),
		user_has_permission: z.boolean().optional(),
	} )
	.passthrough();

export type CreatedStagingSite = z.infer< typeof createdStagingSiteResponseSchema >;

const initialState: StagingSyncSliceState = {
	states: {},
};

const ACTIVE_STAGING_SYNC_STATUSES = new Set< StagingSyncStatus >( [ 'started', 'in-progress' ] );

function getApiErrorStatus( error: unknown ) {
	if ( error && typeof error === 'object' ) {
		const status = ( error as { status?: unknown } ).status;
		if ( typeof status === 'number' ) {
			return status;
		}

		const statusCode = ( error as { statusCode?: unknown } ).statusCode;
		if ( typeof statusCode === 'number' ) {
			return statusCode;
		}

		const dataStatus = ( error as { data?: { status?: unknown } } ).data?.status;
		if ( typeof dataStatus === 'number' ) {
			return dataStatus;
		}
	}

	return undefined;
}

export function getStagingSyncApiError( error: unknown ): StagingSyncApiError {
	if ( error instanceof z.ZodError ) {
		return {
			code: 'invalid_sync_state_response',
			message: __( 'The staging sync response was not in the expected format.' ),
		};
	}

	if ( error && typeof error === 'object' ) {
		const code = ( error as { code?: unknown } ).code;
		const message = ( error as { message?: unknown } ).message;

		return {
			code: typeof code === 'string' ? code : undefined,
			message:
				typeof message === 'string' && message.length > 0
					? message
					: __( 'The staging sync could not be completed.' ),
			status: getApiErrorStatus( error ),
		};
	}

	return {
		message:
			error instanceof Error ? error.message : __( 'The staging sync could not be completed.' ),
	};
}

function normalizeStatus( status: string ): StagingSyncStatus {
	if ( status === 'started' || status === 'in-progress' || status === 'completed' ) {
		return status;
	}

	return status === 'failed' ? 'failed' : 'in-progress';
}

function normalizeOptions( options: unknown ): StagingSyncOptions | undefined {
	if ( Array.isArray( options ) ) {
		return options.filter( ( option ): option is StagingSyncOption =>
			( STAGING_SYNC_OPTION_TOKENS as readonly string[] ).includes( option )
		);
	}

	if ( options && typeof options === 'object' ) {
		const {
			types,
			include_paths: includePaths,
			exclude_paths: excludePaths,
		} = options as {
			types?: unknown;
			include_paths?: unknown;
			exclude_paths?: unknown;
		};
		if ( types === 'paths' && Array.isArray( includePaths ) ) {
			return {
				types,
				include_paths: includePaths.filter(
					( includePath ): includePath is string => typeof includePath === 'string'
				),
				exclude_paths: Array.isArray( excludePaths )
					? excludePaths.filter(
							( excludePath ): excludePath is string => typeof excludePath === 'string'
					  )
					: undefined,
			};
		}

		if ( typeof types === 'string' ) {
			return normalizeOptions( types.split( ',' ) );
		}
	}

	return undefined;
}

export const startStagingSiteSync = createAsyncThunk<
	{ productionSiteId: number },
	{
		productionSite: SyncSite;
		stagingSite: SyncSite;
		direction: StagingSyncDirection;
		options: StagingSyncOptions;
		allowWooSync?: boolean;
	},
	{ rejectValue: StagingSyncApiError }
>(
	'stagingSync/start',
	async (
		{ productionSite, stagingSite, direction, options, allowWooSync },
		{ rejectWithValue }
	) => {
		const wpcomClient = getWpcomClient();
		if ( ! wpcomClient ) {
			return rejectWithValue( {
				code: 'not_authenticated',
				message: __( 'Log in to WordPress.com to sync staging sites.' ),
				status: 401,
			} );
		}

		try {
			const path =
				direction === 'push'
					? `/sites/${ productionSite.id }/staging-site/push-to-staging/${ stagingSite.id }`
					: `/sites/${ productionSite.id }/staging-site/pull-from-staging/${ stagingSite.id }`;
			const response = await wpcomClient.req.post( {
				apiNamespace: 'wpcom/v2',
				path,
				body: {
					options,
					...( allowWooSync ? { allow_woo_sync: true } : {} ),
				},
			} );
			successResponseSchema.parse( response );

			return { productionSiteId: productionSite.id };
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
			return rejectWithValue( getStagingSyncApiError( error ) );
		}
	}
);

export const fetchStagingSiteSyncState = createAsyncThunk<
	StagingSyncState,
	{ productionSiteId: number },
	{ rejectValue: StagingSyncApiError }
>( 'stagingSync/fetchState', async ( { productionSiteId }, { rejectWithValue } ) => {
	const wpcomClient = getWpcomClient();
	if ( ! wpcomClient ) {
		return rejectWithValue( {
			code: 'not_authenticated',
			message: __( 'Log in to WordPress.com to sync staging sites.' ),
			status: 401,
		} );
	}

	try {
		const response = await wpcomClient.req.get( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ productionSiteId }/staging-site/sync-state`,
		} );

		if ( ! response ) {
			return {
				productionSiteId,
				status: 'idle',
			};
		}

		const parsed = stagingSyncStateResponseSchema.parse( response );

		return {
			productionSiteId: parsed.production_blog_id,
			stagingSiteId: parsed.staging_blog_id,
			status: normalizeStatus( parsed.status ),
			direction: parsed.direction,
			restoreId: parsed.restore_id,
			lastRestoreId: parsed.last_restore_id,
			startedAt: parsed.started_at,
			completedAt: parsed.completed_at,
			updatedAt: parsed.updated_at,
			options: normalizeOptions( parsed.options ),
		};
	} catch ( error ) {
		const apiError = getStagingSyncApiError( error );
		if ( apiError.status === 204 ) {
			return {
				productionSiteId,
				status: 'idle',
			};
		}

		if ( apiError.status === 404 || apiError.code === 'no_staging_sites' ) {
			return {
				productionSiteId,
				status: 'no-staging',
				error: apiError,
			};
		}

		Sentry.captureException( error );
		console.error( error );
		return rejectWithValue( apiError );
	}
} );

export const createStagingSite = createAsyncThunk<
	CreatedStagingSite,
	{ productionSite: SyncSite },
	{ rejectValue: StagingSyncApiError }
>( 'stagingSync/createStagingSite', async ( { productionSite }, { rejectWithValue } ) => {
	const wpcomClient = getWpcomClient();
	if ( ! wpcomClient ) {
		return rejectWithValue( {
			code: 'not_authenticated',
			message: __( 'Log in to WordPress.com to create a staging site.' ),
			status: 401,
		} );
	}

	try {
		const response = await wpcomClient.req.post( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ productionSite.id }/staging-site`,
		} );

		return createdStagingSiteResponseSchema.parse( response );
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( error );
		return rejectWithValue( getStagingSyncApiError( error ) );
	}
} );

const stagingSyncSlice = createSlice( {
	name: 'stagingSync',
	initialState,
	reducers: {
		clearStagingSyncState: ( state, action: PayloadAction< { productionSiteId: number } > ) => {
			delete state.states[ action.payload.productionSiteId ];
		},
		markStagingSyncTimedOut: ( state, action: PayloadAction< { productionSiteId: number } > ) => {
			const currentState = state.states[ action.payload.productionSiteId ];
			if ( currentState && ACTIVE_STAGING_SYNC_STATUSES.has( currentState.status ) ) {
				currentState.status = 'timed-out';
			}
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( startStagingSiteSync.pending, ( state, action ) => {
				const { productionSite, stagingSite, direction, options } = action.meta.arg;
				state.states[ productionSite.id ] = {
					productionSiteId: productionSite.id,
					stagingSiteId: stagingSite.id,
					status: 'started',
					direction,
					options,
					startedAt: new Date().toISOString(),
				};
			} )
			.addCase( startStagingSiteSync.rejected, ( state, action ) => {
				const { productionSite, stagingSite, direction, options } = action.meta.arg;
				state.states[ productionSite.id ] = {
					productionSiteId: productionSite.id,
					stagingSiteId: stagingSite.id,
					status: 'failed',
					direction,
					options,
					error: action.payload ?? getStagingSyncApiError( action.error ),
				};
			} )
			.addCase( fetchStagingSiteSyncState.fulfilled, ( state, action ) => {
				const currentState = state.states[ action.payload.productionSiteId ];
				if (
					action.payload.status === 'idle' &&
					currentState &&
					ACTIVE_STAGING_SYNC_STATUSES.has( currentState.status )
				) {
					return;
				}

				state.states[ action.payload.productionSiteId ] = {
					...currentState,
					...action.payload,
				};
			} )
			.addCase( fetchStagingSiteSyncState.rejected, ( state, action ) => {
				const { productionSiteId } = action.meta.arg;
				state.states[ productionSiteId ] = {
					...state.states[ productionSiteId ],
					productionSiteId,
					status: 'failed',
					error: action.payload ?? getStagingSyncApiError( action.error ),
				};
			} );
	},
} );

export const stagingSyncActions = stagingSyncSlice.actions;
export const stagingSyncReducer = stagingSyncSlice.reducer;

export const stagingSyncSelectors = {
	selectState: ( productionSiteId?: number ) => ( state: RootState ) =>
		productionSiteId ? state.stagingSync.states[ productionSiteId ] : undefined,
	selectIsProductionSiteSyncing: ( productionSiteId?: number ) => ( state: RootState ) => {
		const stagingSyncState = productionSiteId
			? state.stagingSync.states[ productionSiteId ]
			: undefined;
		return stagingSyncState ? ACTIVE_STAGING_SYNC_STATUSES.has( stagingSyncState.status ) : false;
	},
	selectIsRemoteSiteEnvironmentSyncing: ( siteId?: number ) => ( state: RootState ) => {
		if ( ! siteId ) {
			return false;
		}

		return Object.values( state.stagingSync.states ).some(
			( stagingSyncState ) =>
				ACTIVE_STAGING_SYNC_STATUSES.has( stagingSyncState.status ) &&
				( stagingSyncState.productionSiteId === siteId ||
					stagingSyncState.stagingSiteId === siteId )
		);
	},
	selectRemoteSiteEnvironmentSyncState: ( siteId?: number ) => ( state: RootState ) => {
		if ( ! siteId ) {
			return undefined;
		}

		return Object.values( state.stagingSync.states ).find(
			( stagingSyncState ) =>
				stagingSyncState.productionSiteId === siteId || stagingSyncState.stagingSiteId === siteId
		);
	},
};

export const stagingSyncThunks = {
	startStagingSiteSync,
	fetchStagingSiteSyncState,
	createStagingSite,
};
