/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Enforce locking when calling saveUserData or saveAppdata',
			category: 'Possible Errors',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			missingLock:
				'Function that calls saveUserData() or saveAppdata() must be wrapped with lockAppdata() and unlockAppdata().',
			missingUnlock: 'lockAppdata() must be followed by unlockAppdata() in a try/finally block.',
		},
	},
	create( context ) {
		const saveFunctions = [ 'saveUserData', 'saveAppdata' ];
		const functionStack = [];

		function getCurrentFunction() {
			return functionStack[ functionStack.length - 1 ];
		}

		function enterFunction() {
			functionStack.push( {
				hasLockCall: false,
				hasUnlockCall: false,
				hasTryFinally: false,
			} );
		}

		function exitFunction( node ) {
			const current = getCurrentFunction();
			if (
				current &&
				current.hasLockCall &&
				( ! current.hasTryFinally || ! current.hasUnlockCall )
			) {
				context.report( {
					node,
					messageId: 'missingUnlock',
				} );
			}
			functionStack.pop();
		}

		return {
			CallExpression( node ) {
				const current = getCurrentFunction();
				if ( ! current ) return;

				if ( node.callee.name === 'lockAppdata' ) {
					current.hasLockCall = true;
				}
				if ( node.callee.name === 'unlockAppdata' ) {
					current.hasUnlockCall = true;
				}

				// Any call to saveUserData or saveAppdata requires lock
				if ( saveFunctions.includes( node.callee.name ) ) {
					if ( ! current.hasLockCall ) {
						context.report( {
							node,
							messageId: 'missingLock',
						} );
					}
				}
			},
			TryStatement( node ) {
				const current = getCurrentFunction();
				if ( current && node.finalizer ) {
					current.hasTryFinally = true;
				}
			},
			FunctionDeclaration() {
				enterFunction();
			},
			'FunctionDeclaration:exit'( node ) {
				exitFunction( node );
			},
			ArrowFunctionExpression() {
				enterFunction();
			},
			'ArrowFunctionExpression:exit'( node ) {
				exitFunction( node );
			},
			FunctionExpression() {
				enterFunction();
			},
			'FunctionExpression:exit'( node ) {
				exitFunction( node );
			},
		};
	},
};
