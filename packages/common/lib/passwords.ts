import { generatePassword } from '@automattic/generate-password';
import { __, sprintf } from '@wordpress/i18n';

export { generatePassword };

/**
 * Defaults for a site's admin credentials, shared by both front ends and the CLI so an
 * unset value resolves to the same thing everywhere. A site whose config predates these
 * fields — or that only ever had one of them set — falls back to these on start.
 */
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'password';
export const DEFAULT_ADMIN_EMAIL = 'admin@localhost.com';

/**
 * Resolves a site's stored (encoded) admin password to plain text, falling back to the
 * default when nothing is stored. Callers that send credentials to WordPress must use
 * this rather than skipping the field: omitting the password fails the admin API when
 * the username names a user that does not exist yet.
 */
export function decodeAdminPassword( encodedPassword?: string ): string {
	return encodedPassword ? decodePassword( encodedPassword ) : DEFAULT_ADMIN_PASSWORD;
}

/**
 * Generates a random, Base64-encoded password.
 *
 * @returns The Base64-encoded password.
 */
export function createPassword(): string {
	return encodePassword( generatePassword() );
}

/**
 * Encodes a plain-text password to Base64.
 * Uses TextEncoder to properly handle Unicode characters.
 *
 * @param password - The plain-text password to encode.
 * @returns The Base64-encoded password.
 */
export function encodePassword( password: string ): string {
	const bytes = new TextEncoder().encode( password );
	const binary = String.fromCharCode( ...bytes );
	return btoa( binary );
}

/**
 * Decodes a Base64-encoded password.
 * Uses TextDecoder to properly handle Unicode characters.
 *
 * @param encodedPassword - The password to decode.
 * @returns The decoded password.
 */
export function decodePassword( encodedPassword: string ): string {
	const binary = atob( encodedPassword );
	const bytes = Uint8Array.from( binary, ( char ) => char.charCodeAt( 0 ) );
	return new TextDecoder().decode( bytes );
}

/**
 * Validates an admin email and returns an error message, or empty string if valid.
 */
export function validateAdminEmail( email: string ): string {
	if ( ! email.trim() ) {
		return __( 'Admin email cannot be empty.' );
	}
	if ( ! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( email ) ) {
		return __( 'Please enter a valid email address.' );
	}
	return '';
}

/**
 * Validates an admin username and returns an error message, or empty string if valid.
 */
export function validateAdminUsername( username: string ): string {
	if ( ! username.trim() ) {
		return __( 'Admin username cannot be empty.' );
	}
	if ( ! /^[a-zA-Z0-9_.@-]+$/.test( username ) ) {
		return __( 'Username can only contain letters, numbers, and _.@- characters.' );
	}
	const USERNAME_MAX_LENGTH = 60;
	if ( username.length > USERNAME_MAX_LENGTH ) {
		/* translators: %d is the maximum number of characters allowed in a username */
		return sprintf( __( 'Username must be %d characters or fewer.' ), USERNAME_MAX_LENGTH );
	}
	return '';
}
