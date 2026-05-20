const path = require( 'path' );
const tailwindcss = require( 'tailwindcss' );

const preserveAgentticBaseLayer = {
	postcssPlugin: 'preserve-agenttic-base-layer',
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
				rule.params = 'agenttic-base';
			}
		} );
	},
};

module.exports = {
	plugins: [
		preserveAgentticBaseLayer,
		tailwindcss( {
			config: path.join( __dirname, 'tailwind.config.js' ),
		} ),
	],
};
