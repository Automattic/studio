import { z } from 'zod';
import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

type AnyRtkError = FetchBaseQueryError | SerializedError | undefined;

const isFetchErr = ( e: unknown ): e is FetchBaseQueryError =>
	!! e && typeof e === 'object' && 'status' in e;
const isSerialized = ( e: unknown ): e is SerializedError =>
	!! e && typeof e === 'object' && ( 'message' in e || 'stack' in e || 'name' in e );

const mapLowLevelFetchError = ( code: unknown ): string => {
	switch ( code ) {
		case 'PARSING_ERROR':
			return 'Response parsing error';
		case 'TIMEOUT_ERROR':
			return 'Request timed out';
		case 'FETCH_ERROR':
			return 'Network error';
		case 'CUSTOM_ERROR':
			return 'Request failed';
		default:
			return String( code ?? 'Request failed' );
	}
};

const errorPayloadSchema = z.object( {
	message: z.string().optional(),
	error: z.string().optional(),
	errors: z.array( z.object( { message: z.string() } ) ).optional(),
} );

const extractMsg = ( data: unknown ): string | undefined => {
	if ( ! data ) {
		return;
	}

	if ( typeof data === 'string' ) {
		return data;
	}

	const parsedPayload = errorPayloadSchema.safeParse( data );
	if ( parsedPayload.success ) {
		if ( parsedPayload.data.message ) {
			return parsedPayload.data.message;
		}
		if ( parsedPayload.data.error ) {
			return parsedPayload.data.error;
		}
		if ( parsedPayload.data.errors?.[ 0 ]?.message ) {
			return parsedPayload.data.errors[ 0 ].message;
		}
	}

	try {
		return JSON.stringify( data );
	} catch {
		return;
	}
};

export const formatRtkError = ( error: AnyRtkError ): string | undefined => {
	if ( ! error ) return;

	// API / network errors
	if ( isFetchErr( error ) ) {
		// Low-level fetchBaseQuery errors (no HTTP status)
		if ( 'error' in error ) {
			return mapLowLevelFetchError( ( error as { error: unknown } ).error );
		}
		// HTTP errors with possible payload
		const status = typeof error.status === 'number' ? error.status : undefined;
		const msg = extractMsg( ( error as { data: unknown } ).data ) ?? 'Request failed';
		return status ? `[${ status }] ${ msg }` : msg;
	}

	// Throws from transformResponse -> SerializedError
	if ( isSerialized( error ) ) {
		return error.message ?? 'Unknown error';
	}

	return 'Unknown error';
};
