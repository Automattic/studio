import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

export const WEBP_QUALITY = 82;

const require = createRequire( import.meta.url );

async function compileWasm( specifier: string ): Promise< WebAssembly.Module > {
	return WebAssembly.compile( await readFile( require.resolve( specifier ) ) );
}

// The codecs fetch their wasm by URL, which Node can't do for a file, so they
// get modules compiled from their package folders; the CLI keeps them external
// for that. Node always has wasm SIMD, which is the encoder build `init` picks.
let codecs: ReturnType< typeof loadCodecs > | undefined;

async function loadCodecs() {
	const [ png, jpeg, webp ] = await Promise.all( [
		import( '@jsquash/png/decode.js' ),
		import( '@jsquash/jpeg/decode.js' ),
		import( '@jsquash/webp/encode.js' ),
	] );
	await Promise.all( [
		png.init( await compileWasm( '@jsquash/png/codec/pkg/squoosh_png_bg.wasm' ) ),
		jpeg.init( await compileWasm( '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm' ) ),
		webp.init( await compileWasm( '@jsquash/webp/codec/enc/webp_enc_simd.wasm' ) ),
	] );
	return { png: png.decode, jpeg: jpeg.default, encodeWebp: webp.default };
}

const startsWith = ( bytes: Uint8Array, signature: number[], offset = 0 ) =>
	signature.every( ( byte, index ) => bytes[ offset + index ] === byte );

const RIFF = [ 0x52, 0x49, 0x46, 0x46 ];
const WEBP = [ 0x57, 0x45, 0x42, 0x50 ];
const PNG = [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ];
const JPEG = [ 0xff, 0xd8, 0xff ];

export function imageFormat( bytes: Uint8Array ): 'webp' | 'png' | 'jpeg' | undefined {
	if ( startsWith( bytes, RIFF ) && startsWith( bytes, WEBP, 8 ) ) {
		return 'webp';
	}
	if ( startsWith( bytes, PNG ) ) {
		return 'png';
	}
	if ( startsWith( bytes, JPEG ) ) {
		return 'jpeg';
	}
	return undefined;
}

/**
 * Returns `bytes` as a lossy WebP, encoding PNG or JPEG input; WebP input is
 * kept as is.
 */
export async function toWebp( bytes: Uint8Array ): Promise< Uint8Array > {
	const format = imageFormat( bytes );
	if ( format === 'webp' ) {
		return bytes;
	}
	if ( ! format ) {
		throw new Error( 'The image is neither a WebP, a PNG nor a JPEG' );
	}
	codecs ??= loadCodecs();
	const { encodeWebp, ...decoders } = await codecs;
	const pixels = await decoders[ format ]( bytes.slice().buffer );
	return new Uint8Array( await encodeWebp( pixels, { quality: WEBP_QUALITY } ) );
}
