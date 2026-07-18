import { vi } from 'vitest';

type StubImageEnvironmentOptions = {
	width: number;
	height: number;
	transparent?: boolean;
	/** Encoded blob size per [type, quality] attempt; defaults to a tiny blob. */
	blobBytes?: ( type: string, quality: number ) => number;
};

// jsdom implements neither createImageBitmap nor canvas 2D contexts, so tests
// stub both with fakes that report the given source dimensions and encode to a
// controllable blob size.
export function stubImageEnvironment( {
	width,
	height,
	transparent = false,
	blobBytes = () => 'downscaled'.length,
}: StubImageEnvironmentOptions ) {
	const close = vi.fn();
	const createdCanvases: Array< { width: number; height: number } > = [];
	const drawImage = vi.fn();
	const encodeAttempts: Array< { type: string; quality: number } > = [];

	vi.stubGlobal(
		'createImageBitmap',
		vi.fn( async () => ( { width, height, close } ) )
	);

	class FakeOffscreenCanvas {
		width: number;
		height: number;

		constructor( canvasWidth: number, canvasHeight: number ) {
			this.width = canvasWidth;
			this.height = canvasHeight;
			createdCanvases.push( { width: canvasWidth, height: canvasHeight } );
		}

		getContext() {
			return {
				drawImage,
				fillRect: () => {},
				globalCompositeOperation: 'source-over',
				fillStyle: '',
				getImageData: ( _x: number, _y: number, imageWidth: number, imageHeight: number ) => ( {
					data: new Uint8ClampedArray( imageWidth * imageHeight * 4 ).fill( transparent ? 0 : 255 ),
				} ),
			};
		}

		convertToBlob( { type, quality }: { type: string; quality: number } ) {
			encodeAttempts.push( { type, quality } );
			return Promise.resolve(
				new Blob( [ new Uint8Array( blobBytes( type, quality ) ) ], { type } )
			);
		}
	}
	vi.stubGlobal( 'OffscreenCanvas', FakeOffscreenCanvas );

	return { close, createdCanvases, drawImage, encodeAttempts };
}
