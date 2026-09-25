import type { ImportResponse } from '@studio/common/types/sync';

/**
 * Builds a human-readable reason from a failed push import status.
 *
 * The API reports why the remote import failed in `error`, and when the
 * remote-side restore is what broke, VaultPress adds its own message in
 * `error_data.vp_restore_message`. Returns an empty string when the API said
 * nothing useful, so callers can fall back to a generic message.
 */
export function importFailureReason( status: ImportResponse ): string {
	if ( status.status !== 'failed' ) {
		return '';
	}
	return [ status.error, status.error_data?.vp_restore_message ]
		.filter( ( part ): part is string => typeof part === 'string' && part.trim() !== '' )
		.map( ( part ) => part.trim() )
		.join( ' — ' );
}
