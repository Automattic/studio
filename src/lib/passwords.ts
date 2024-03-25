import { safeStorage } from 'electron';
import { generatePassword } from '@automattic/generate-password';

/**
 * Generates a random password, encrypts it, and returns the encrypted password as a base64 string.
 *
 * @returns The encrypted password as a base64 string.
 */
export function createPassword(): string {
	const password = generatePassword();
	const encryptedPassword = safeStorage.encryptString( password ).toString( 'base64' );
	return encryptedPassword;
}

/**
 * Decrypts the encrypted password.
 *
 * @param encryptedPassword - The encrypted password to decrypt.
 * @returns The decrypted password.
 */
export function decryptPassword( encryptedPassword: string ): string {
	return safeStorage.decryptString( Buffer.from( encryptedPassword, 'base64' ) );
}
