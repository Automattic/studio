import crypto from 'crypto';

export function generateRandomHex( byteLength = 16 ): string {
	return crypto.randomBytes( byteLength ).toString( 'hex' );
}
