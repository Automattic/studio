/**
 * Resize base64-encoded images that exceed the Anthropic API's 5MB limit.
 * Uses an off-screen canvas in the renderer process.
 */

const MAX_BASE64_SIZE = 4 * 1024 * 1024; // 4MB — leave headroom below the 5MB API limit

/**
 * Check if a base64 image string is within the API size limit.
 * If it exceeds the limit, resize it using a canvas and return JPEG.
 */
export async function resizeImageIfNeeded(
	base64: string,
	mediaType: string
): Promise< { data: string; mediaType: string } > {
	if ( base64.length <= MAX_BASE64_SIZE ) {
		return { data: base64, mediaType };
	}

	const img = new Image();
	const dataUrl = `data:${ mediaType };base64,${ base64 }`;

	await new Promise< void >( ( resolve, reject ) => {
		img.onload = () => resolve();
		img.onerror = () => reject( new Error( 'Failed to load image for resizing' ) );
		img.src = dataUrl;
	} );

	const canvas = document.createElement( 'canvas' );
	const ctx = canvas.getContext( '2d' )!;

	let quality = 0.85;
	let scale = 1;
	let result = base64;

	// Progressively reduce dimensions and quality until under the limit
	for ( let attempt = 0; attempt < 6; attempt++ ) {
		canvas.width = Math.round( img.width * scale );
		canvas.height = Math.round( img.height * scale );
		ctx.drawImage( img, 0, 0, canvas.width, canvas.height );

		const outputDataUrl = canvas.toDataURL( 'image/jpeg', quality );
		result = outputDataUrl.split( ',' )[ 1 ];

		if ( result.length <= MAX_BASE64_SIZE ) {
			return { data: result, mediaType: 'image/jpeg' };
		}

		scale *= 0.7;
		quality = Math.max( 0.4, quality - 0.1 );
	}

	// Return the smallest version we managed
	return { data: result, mediaType: 'image/jpeg' };
}
