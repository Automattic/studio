/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				"Keep feature CSS out of the UI primitives' internals: their parts and private custom properties.",
		},
		schema: [
			{
				type: 'object',
				properties: { properties: { type: 'array', items: { type: 'string' } } },
				additionalProperties: false,
			},
		],
		messages: {
			part: "Don't style a primitive's parts through `[data-slot]`. Add a prop or variant to the primitive, or fix it there for every caller.",
			property:
				"`{{ property }}` is private to a primitive. Use a variant, or one of the primitive's documented hooks.",
		},
	},
	create( context ) {
		const properties = new Set( context.options[ 0 ]?.properties ?? [] );
		return {
			Rule( node ) {
				if ( /\[\s*data-slot\b/.test( context.sourceCode.getText( node.prelude ) ) ) {
					context.report( { node: node.prelude, messageId: 'part' } );
				}
			},
			Declaration( node ) {
				if ( properties.has( node.property ) ) {
					context.report( { node, messageId: 'property', data: { property: node.property } } );
				}
			},
		};
	},
};
