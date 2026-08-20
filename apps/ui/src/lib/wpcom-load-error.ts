import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';

/**
 * A short, user-facing explanation for a failed WordPress.com request.
 * Classifies the common failure modes and falls back to a connectivity hint.
 */
export function getWpcomLoadErrorDetail( error: unknown ): string {
	// Unwrap Electron's "Error invoking remote method '…':" IPC prefix so the
	// user sees the underlying message, not the transport.
	const message = getErrorMessage( error )
		?.replace( /^Error invoking remote method '[^']+':\s*/i, '' )
		.replace( /^Error:\s*/i, '' )
		.trim();
	if ( ! message ) {
		return __( 'Check your internet connection and try again.' );
	}
	if ( /auth|token|sign[ -]?in|unauthori[sz]ed|\b401\b/i.test( message ) ) {
		return __( 'Your WordPress.com session may have expired.' );
	}
	if ( /network|offline|timed? out|timeout|econn|enotfound|failed to fetch/i.test( message ) ) {
		return __( 'Check your internet connection and try again.' );
	}
	if ( /rate.?limit|too many requests|\b429\b/i.test( message ) ) {
		return __( 'WordPress.com is receiving too many requests. Try again in a moment.' );
	}
	if ( /\b5\d\d\b|service unavailable|bad gateway/i.test( message ) ) {
		return __( 'WordPress.com may be temporarily unavailable. Try again in a moment.' );
	}
	// Only surface the raw message if it's short and not a raw HTTP-request
	// dump; otherwise fall back to the generic hint.
	if ( message.length <= 180 && ! /\b(?:GET|POST) \/.*failed/i.test( message ) ) {
		return message;
	}
	return __( 'Check your internet connection and try again.' );
}
