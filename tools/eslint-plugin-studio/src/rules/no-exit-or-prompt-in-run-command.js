/**
 * Command `runCommand` functions are also called in-process (by the Studio Code agent) and by
 * hosts that fork the CLI without a terminal, so they must neither exit the process nor prompt.
 * Exits and prompts belong in the yargs handler, which only runs from a terminal command.
 */

function isRunCommand( node ) {
	if ( node.type === 'FunctionDeclaration' ) {
		return node.id?.name === 'runCommand';
	}
	return (
		node.parent?.type === 'VariableDeclarator' &&
		node.parent.id.type === 'Identifier' &&
		node.parent.id.name === 'runCommand'
	);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow process.exit() and interactive prompts in CLI runCommand functions',
		},
		schema: [],
		messages: {
			exit: 'runCommand must not call process.exit(): throw, or set process.exitCode, instead.',
			prompt:
				'runCommand must not prompt: take the answer as an argument and ask for it in the handler.',
		},
	},
	create( context ) {
		const promptNames = new Set();
		let depth = 0;

		const enter = ( node ) => {
			if ( depth > 0 || isRunCommand( node ) ) {
				depth++;
			}
		};
		const exit = () => {
			if ( depth > 0 ) {
				depth--;
			}
		};

		return {
			ImportDeclaration( node ) {
				if ( ! node.source.value.startsWith( '@inquirer/' ) ) {
					return;
				}
				for ( const specifier of node.specifiers ) {
					promptNames.add( specifier.local.name );
				}
			},
			FunctionDeclaration: enter,
			FunctionExpression: enter,
			ArrowFunctionExpression: enter,
			'FunctionDeclaration:exit': exit,
			'FunctionExpression:exit': exit,
			'ArrowFunctionExpression:exit': exit,
			CallExpression( node ) {
				if ( depth === 0 ) {
					return;
				}
				const { callee } = node;
				if (
					callee.type === 'MemberExpression' &&
					callee.object.type === 'Identifier' &&
					callee.object.name === 'process' &&
					callee.property.type === 'Identifier' &&
					callee.property.name === 'exit'
				) {
					context.report( { node, messageId: 'exit' } );
				} else if ( callee.type === 'Identifier' && promptNames.has( callee.name ) ) {
					context.report( { node, messageId: 'prompt' } );
				} else if (
					callee.type === 'MemberExpression' &&
					callee.object.type === 'Identifier' &&
					promptNames.has( callee.object.name )
				) {
					context.report( { node, messageId: 'prompt' } );
				}
			},
		};
	},
};
