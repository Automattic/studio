import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

const __dirname = import.meta.dirname;

// Hosts take the page as one HTML resource, so its one script and one
// stylesheet go inline.
const inlineBundle: Plugin = {
	name: 'inline-bundle',
	apply: 'build',
	enforce: 'post',
	generateBundle( _options, bundle ) {
		const files = Object.values( bundle );
		const html = files.find( ( file ) => file.fileName === 'index.html' );
		const script = files.find( ( file ) => file.type === 'chunk' );
		const style = files.find( ( file ) => file.fileName.endsWith( '.css' ) );
		if ( html?.type !== 'asset' || script?.type !== 'chunk' || style?.type !== 'asset' ) {
			throw new Error( 'Expected one page, one script and one stylesheet.' );
		}
		html.source = String( html.source )
			.replace( /<script[^>]*><\/script>/, '' )
			.replace( /<link[^>]*stylesheet[^>]*>/, () => `<style>${ style.source }</style>` )
			.replace(
				'</body>',
				() =>
					`<script type="module">${ script.code.replace(
						/<\/script/gi,
						'<\\/script'
					) }</script></body>`
			);
		delete bundle[ script.fileName ];
		delete bundle[ style.fileName ];
	},
};

export default defineConfig( {
	plugins: [ inlineBundle ],
	resolve: {
		alias: { '@': resolve( __dirname, 'src' ) },
	},
	build: {
		outDir: 'dist',
		// Keeps light-dark(), which follows the host's theme through color-scheme.
		cssTarget: [ 'chrome123', 'firefox120', 'safari17.5' ],
		cssCodeSplit: false,
		modulePreload: false,
		rolldownOptions: {
			output: { codeSplitting: false },
		},
	},
} );
