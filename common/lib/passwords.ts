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
 *
 * @param password - The plain-text password to encode.
 * @returns The Base64-encoded password.
 */
export function encodePassword( password: string ): string {
	return btoa( password );
}

/**
 * Decodes a Base64-encoded password.
 *
 * @param encodedPassword - The password to decode.
 * @returns The decoded password.
 */
export function decodePassword( encodedPassword: string ): string {
	return atob( encodedPassword ).toString();
}
