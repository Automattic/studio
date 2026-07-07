import { vi } from 'vitest';

type StubImageEnvironmentOptions = {
	width: number;
	height: number;
	transparent?: boolean;
};

// jsdom implements neither createImageBitmap nor canvas 2D contexts, so tests
// stub both with fakes that report the given source dimensions and encode to a
// fixed "downscaled" blob.
export function stubImageEnvironment( {
	width,
	height,
	transparent = false,
}: StubImageEnvironmentOptions ) {
	const close = vi.fn();
	const createdCanvases: Array< { width: number; height: number } > = [];
	const drawImage = vi.fn();

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
				getImageData: ( _x: number, _y: number, imageWidth: number, imageHeight: number ) => ( {
					data: new Uint8ClampedArray( imageWidth * imageHeight * 4 ).fill( transparent ? 0 : 255 ),
				} ),
			};
		}

		convertToBlob( { type }: { type: string } ) {
			return Promise.resolve( new Blob( [ 'downscaled' ], { type } ) );
		}
	}
	vi.stubGlobal( 'OffscreenCanvas', FakeOffscreenCanvas );

	return { close, createdCanvases, drawImage };
}
