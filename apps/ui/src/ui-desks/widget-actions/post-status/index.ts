import { __ } from '@wordpress/i18n';

export const CONTENT_CARD_STATUSES = [ 'publish', 'draft', 'pending', 'future', 'private' ];

export function getPostStatusInfo( status: string | undefined ): { color: string; label: string } {
	switch ( status ) {
		case 'publish':
			return { color: '#22c55e', label: __( 'Published' ) };
		case 'pending':
			return { color: '#f59e0b', label: __( 'Pending review' ) };
		case 'future':
			return { color: '#3b82f6', label: __( 'Scheduled' ) };
		case 'private':
			return { color: '#a855f7', label: __( 'Private' ) };
		case 'draft':
		case 'auto-draft':
			return { color: '#9ca3af', label: __( 'Draft' ) };
		default:
			return { color: '#9ca3af', label: status ?? __( 'Loading…' ) };
	}
}
