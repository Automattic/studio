import { generatePassword } from '@automattic/generate-password';

/**
 * Generates a random, Base64-encoded password.
 *
 * @returns The Base64-encoded password.
 */
export function createPassword(): string {
	return btoa( generatePassword() );
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
