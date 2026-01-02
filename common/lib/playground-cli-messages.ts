import { __ } from '@wordpress/i18n';

/**
 * Formats playground-cli log messages into user-friendly translated messages.
 *
 * @param message - The raw message from playground-cli
 * @returns Formatted message for UI display
 */
export function formatPlaygroundCliMessage( message: string ): string {
	if ( message.includes( 'WordPress is running' ) ) {
		return __( 'WordPress is running' );
	}
	if ( message.includes( 'Resolved WordPress release URL' ) ) {
		return __( 'Downloading WordPress…' );
	}
	if ( message.includes( 'Downloading WordPress' ) ) {
		return __( 'Downloading WordPress…' );
	}
	if ( message.includes( 'Starting up workers' ) ) {
		return __( 'Starting up workers…' );
	}
	if ( message.includes( 'Booting WordPress' ) ) {
		return __( 'Booting WordPress…' );
	}
	if ( message.includes( 'Running the Blueprint' ) ) {
		return __( 'Running the Blueprint…' );
	}
	// Exclude this message to prevent users from thinking the entire boot process is complete
	if ( message.includes( 'Finished running the blueprint' ) ) {
		return '';
	}
	if ( message.includes( 'Preparing workers' ) ) {
		return __( 'Preparing workers…' );
	}
	return message;
}
