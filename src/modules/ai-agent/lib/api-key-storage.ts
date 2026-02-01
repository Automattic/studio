import { safeStorage } from 'electron';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

const API_KEY_FIELD = 'anthropicApiKey';
const ENCRYPTED_KEY_FIELD = 'anthropicApiKeyEncrypted';

/**
 * Saves the Anthropic API key securely using Electron's safeStorage.
 * Falls back to plain storage if encryption is not available.
 */
export async function saveApiKey( apiKey: string ): Promise< void > {
	if ( safeStorage.isEncryptionAvailable() ) {
		const encryptedBuffer = safeStorage.encryptString( apiKey );
		const encryptedBase64 = encryptedBuffer.toString( 'base64' );
		await updateAppdata( {
			[ ENCRYPTED_KEY_FIELD ]: encryptedBase64,
			[ API_KEY_FIELD ]: undefined,
		} as Record< string, unknown > );
	} else {
		// Fallback to plain storage if encryption is not available
		console.warn( 'Encryption not available, storing API key in plain text' );
		await updateAppdata( {
			[ API_KEY_FIELD ]: apiKey,
			[ ENCRYPTED_KEY_FIELD ]: undefined,
		} as Record< string, unknown > );
	}
}

/**
 * Retrieves the Anthropic API key from secure storage.
 * Returns null if no key is stored.
 */
export async function getApiKey(): Promise< string | null > {
	const userData = ( await loadUserData() ) as Record< string, unknown >;

	// Try encrypted storage first
	const encryptedBase64 = userData[ ENCRYPTED_KEY_FIELD ] as string | undefined;
	if ( encryptedBase64 && safeStorage.isEncryptionAvailable() ) {
		try {
			const encryptedBuffer = Buffer.from( encryptedBase64, 'base64' );
			return safeStorage.decryptString( encryptedBuffer );
		} catch ( error ) {
			console.error( 'Failed to decrypt API key:', error );
			return null;
		}
	}

	// Fallback to plain storage
	const plainKey = userData[ API_KEY_FIELD ] as string | undefined;
	return plainKey || null;
}

/**
 * Checks if an API key is configured.
 */
export async function hasApiKey(): Promise< boolean > {
	const key = await getApiKey();
	return key !== null && key.length > 0;
}

/**
 * Removes the stored API key.
 */
export async function removeApiKey(): Promise< void > {
	await updateAppdata( {
		[ API_KEY_FIELD ]: undefined,
		[ ENCRYPTED_KEY_FIELD ]: undefined,
	} as Record< string, unknown > );
}

/**
 * Validates that an API key has the expected format for Anthropic keys.
 */
export function validateApiKeyFormat( apiKey: string ): boolean {
	// Anthropic API keys start with "sk-ant-" and are fairly long
	return apiKey.startsWith( 'sk-ant-' ) && apiKey.length > 20;
}
