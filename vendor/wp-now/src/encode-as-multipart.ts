/**
 * Encodes the Express request with files into multipart/form-data request body.
 * Adaptation of https://github.com/WordPress/wordpress-playground/blob/45bf16970867cc6f23738224dacf201905adcab6/packages/php-wasm/universal/src/lib/encode-as-multipart.ts
 */
export async function encodeAsMultipart( req: Express.Request ) {
	const boundary = `----${ Math.random().toString( 36 ).slice( 2 ) }`;
	const contentType = `multipart/form-data; boundary=${ boundary }`;

	const textEncoder = new TextEncoder();
	const parts: ( string | Uint8Array )[] = [];
	const data = ( req as any ).body as Record< string, string >;
	for ( const [ name, value ] of Object.entries( data ) ) {
		parts.push( `--${ boundary }\r\n` );
		parts.push( `Content-Disposition: form-data; name="${ name }"` );
		parts.push( `\r\n` );
		parts.push( `\r\n` );
		parts.push( textEncoder.encode(value) );
		parts.push( `\r\n` );
	}
	const files = req.files;
	for ( const [ name, value ] of Object.entries( files ) ) {
		if ( ! Array.isArray( value ) ) {
			parts.push( `--${ boundary }\r\n` );
			parts.push( `Content-Disposition: form-data; name="${ name }"` );
			parts.push( ...['; filename="', textEncoder.encode(value.name), '"' ] );
			parts.push( `\r\n` );
			parts.push( `Content-Type: ${ value.mimetype }` );
			parts.push( `\r\n` );
			parts.push( `\r\n` );
			parts.push( value.data );
			parts.push( `\r\n` );
		}
	}
	parts.push( `--${ boundary }--\r\n` );

	const length = parts.reduce( ( acc, part ) => acc + part.length, 0 );
	const bytes = new Uint8Array( length );
	let offset = 0;
	for ( const part of parts ) {
		bytes.set( typeof part === 'string' ? textEncoder.encode( part ) : part, offset );
		offset += part.length;
	}

	return { bytes, contentType };
}
