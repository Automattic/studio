import { generatePassword } from '@automattic/generate-password';

export { generatePassword };

/**
 * Generates a random, Base64-encoded password.
 *
 * @returns The Base64-encoded password.
 */
export function createPassword(): string {
	return btoa( generatePassword() );
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
