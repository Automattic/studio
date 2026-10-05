import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

const __dirname = import.meta.dirname;

// Hosts receive the app as one HTML resource, so the script and styles are inlined.
const inlineBundle: Plugin = {
	name: 'inline-bundle',
	apply: 'build',
	enforce: 'post',
	generateBundle( _options, bundle ) {
		const html = Object.values( bundle ).find( ( file ) => file.fileName.endsWith( '.html' ) );
		if ( ! html || html.type !== 'asset' ) {
			return;
		}
		let source = String( html.source );
		for ( const file of Object.values( bundle ) ) {
			if ( file === html ) {
				continue;
			}
			const escaped = file.fileName.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
			if ( file.type === 'chunk' ) {
				const code = file.code.replace( /<\/script/gi, '<\\/script' );
				source = source.replace(
					new RegExp( `<script[^>]*src="[^"]*${ escaped }"[^>]*></script>` ),
					() => ''
				);
				source = source.replace(
					'</body>',
					() => `<script type="module">${ code }</script>\n</body>`
				);
			} else if ( file.fileName.endsWith( '.css' ) ) {
				source = source.replace(
					new RegExp( `<link[^>]*href="[^"]*${ escaped }"[^>]*>` ),
					() => `<style>${ String( file.source ) }</style>`
				);
			} else {
				continue;
			}
			delete bundle[ file.fileName ];
		}
		html.source = source;
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
		assetsInlineLimit: Number.MAX_SAFE_INTEGER,
		cssCodeSplit: false,
		modulePreload: false,
		rolldownOptions: {
			output: { codeSplitting: false },
		},
	},
} );
