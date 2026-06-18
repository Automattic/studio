/**
 * `cx()` exists to join class names conditionally. When it is called with a
 * single static string it adds nothing — the string can be used directly.
 * This rule flags those calls and removes the wrapping `cx(...)`.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow wrapping a single static string in cx(); use the bare string and reserve cx() for conditional classes',
			category: 'Best Practices',
			recommended: true,
		},
		fixable: 'code',
		schema: [],
		messages: {
			redundantCx:
				'cx() with a single static string is redundant. Use the string directly and keep cx() for conditional classes.',
		},
	},
	create( context ) {
		const sourceCode = context.sourceCode || context.getSourceCode();

		/**
		 * A node is a static string when it is a plain string literal or a
		 * template literal with no `${ }` interpolations.
		 */
		function isStaticString( node ) {
			if ( node.type === 'Literal' ) {
				return typeof node.value === 'string';
			}
			if ( node.type === 'TemplateLiteral' ) {
				return node.expressions.length === 0;
			}
			return false;
		}

		return {
			CallExpression( node ) {
				if ( node.callee.type !== 'Identifier' || node.callee.name !== 'cx' ) {
					return;
				}
				if ( node.arguments.length !== 1 ) {
					return;
				}
				const arg = node.arguments[ 0 ];
				if ( ! isStaticString( arg ) ) {
					return;
				}

				context.report( {
					node,
					messageId: 'redundantCx',
					fix( fixer ) {
						return fixer.replaceText( node, sourceCode.getText( arg ) );
					},
				} );
			},
		};
	},
};
