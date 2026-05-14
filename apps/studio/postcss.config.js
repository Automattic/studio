const path = require( 'path' );
const tailwindcss = require( 'tailwindcss' );

const unwrapAgentticBaseLayer = {
	postcssPlugin: 'unwrap-agenttic-base-layer',
	Once( root ) {
		const inputPath = root.source?.input.file ?? '';
		const isAgentticCss = inputPath.includes(
			`${ path.sep }@automattic${ path.sep }agenttic-ui${ path.sep }`
		);

		if ( ! isAgentticCss ) {
			return;
		}

		root.walkAtRules( 'layer', ( rule ) => {
			if ( rule.params === 'base' && rule.nodes ) {
				rule.replaceWith( ...rule.nodes );
			}
		} );
	},
};

module.exports = {
	plugins: [
		unwrapAgentticBaseLayer,
		tailwindcss( {
			config: path.join( __dirname, 'tailwind.config.js' ),
		} ),
	],
};
