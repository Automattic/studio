// Base64 without Node's Buffer, so the tools run in a browser too.

const CHUNK = 0x8000;

export function toBase64( bytes: Uint8Array ): string {
	let binary = '';
	for ( let index = 0; index < bytes.length; index += CHUNK ) {
		binary += String.fromCharCode( ...bytes.subarray( index, index + CHUNK ) );
	}
	return btoa( binary );
}

export function fromBase64( base64: string ): Uint8Array {
	return Uint8Array.from( atob( base64 ), ( char ) => char.charCodeAt( 0 ) );
}
