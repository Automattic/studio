import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

const __dirname = import.meta.dirname;

// Hosts take the page as one HTML resource, so it is written here with the
// build's one script and one stylesheet inline.
const singlePage: Plugin = {
	name: 'single-page',
	apply: 'build',
	// After Vite's CSS plugin, which adds the stylesheet in this same hook.
	enforce: 'post',
	generateBundle( _options, bundle ) {
		const files = Object.values( bundle );
		const script = files.find( ( file ) => file.type === 'chunk' );
		const style = files.find( ( file ) => file.fileName.endsWith( '.css' ) );
		if ( files.length !== 2 || script?.type !== 'chunk' || style?.type !== 'asset' ) {
			throw new Error( 'Expected one script and one stylesheet.' );
		}
		delete bundle[ script.fileName ];
		delete bundle[ style.fileName ];
		const code = script.code.replace( /<\/script/gi, '<\\/script' );
		this.emitFile( {
			type: 'asset',
			fileName: 'index.html',
			source: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WordPress</title><style>${ style.source }</style></head><body><div id="root"></div><script type="module">${ code }</script></body></html>`,
		} );
	},
};

export default defineConfig( {
	plugins: [ singlePage ],
	resolve: {
		alias: { '@': resolve( __dirname, 'src' ) },
	},
	build: {
		outDir: 'dist',
		// Keeps light-dark(), which follows the host's theme through color-scheme.
		cssTarget: [ 'chrome123', 'firefox120', 'safari17.5' ],
		cssCodeSplit: false,
		rolldownOptions: {
			input: resolve( __dirname, 'src/main.tsx' ),
			output: { codeSplitting: false },
		},
	},
} );
