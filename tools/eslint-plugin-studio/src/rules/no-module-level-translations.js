const TRANSLATION_FUNCTIONS = new Set( [ '__', '_x', '_n', '_nx' ] );

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow calling translation functions at module level. ' +
				'Translations must be wrapped in a function so they are evaluated ' +
				'after the locale data has loaded, not when the module is first imported.',
			category: 'Possible Errors',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			moduleLevelTranslation:
				'{{ fn }}() must not be called at module level — it runs before the locale loads. ' +
				'Wrap it in a function so it is evaluated lazily, e.g. `const getLabel = () => {{ fn }}( … )`.',
		},
	},
	create( context ) {
		// Tracks how many function scopes we are currently nested inside.
		// A translation call is safe (lazy) as long as it lives inside any function.
		let functionDepth = 0;

		function enterFunction() {
			functionDepth += 1;
		}

		function exitFunction() {
			functionDepth -= 1;
		}

		return {
			FunctionDeclaration: enterFunction,
			'FunctionDeclaration:exit': exitFunction,
			FunctionExpression: enterFunction,
			'FunctionExpression:exit': exitFunction,
			ArrowFunctionExpression: enterFunction,
			'ArrowFunctionExpression:exit': exitFunction,
			CallExpression( node ) {
				if ( functionDepth > 0 ) {
					return;
				}
				// A bare translation statement whose result is discarded (e.g. `__( 'Next' );`)
				// can never go stale because nothing reads its value. This is the pattern used to
				// feed strings to the translation extractor, so it is allowed at module level.
				if ( node.parent && node.parent.type === 'ExpressionStatement' ) {
					return;
				}
				if ( node.callee.type === 'Identifier' && TRANSLATION_FUNCTIONS.has( node.callee.name ) ) {
					context.report( {
						node,
						messageId: 'moduleLevelTranslation',
						data: { fn: node.callee.name },
					} );
				}
			},
		};
	},
};
