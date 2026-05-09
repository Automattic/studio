import { __ } from '@wordpress/i18n';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL_CHARS = '!@#$%^&*()';
const EXTRA_SPECIAL_CHARS = '-_ []{}<>~`+=,.;:/?|';

/**
 * Generates a cryptographically secure random password.
 */
export function generatePassword( {
	length = 24,
	useNumbers = true,
	useSpecialChars = true,
	useExtraSpecialChars = false,
}: {
	length?: number;
	useNumbers?: boolean;
	useSpecialChars?: boolean;
	useExtraSpecialChars?: boolean;
} = {} ): string {
	let characterPool = ALPHABET;
	if ( useNumbers ) {
		characterPool += DIGITS;
	}
	if ( useSpecialChars ) {
		characterPool += SPECIAL_CHARS;
	}
	if ( useExtraSpecialChars ) {
		characterPool += EXTRA_SPECIAL_CHARS;
	}

	const randomNumber = new Uint8Array( 1 );
	let password = '';

	for ( let i = 0; i < length; i++ ) {
		do {
			globalThis.crypto.getRandomValues( randomNumber );
		} while ( randomNumber[ 0 ] >= characterPool.length );
		password += characterPool[ randomNumber[ 0 ] ];
	}

	return password;
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
	if ( username.length > 60 ) {
		return __( 'Username must be 60 characters or fewer.' );
	}
	return '';
}
