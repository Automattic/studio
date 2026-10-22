const DEFAULT_PAIRS = [
	{
		save: [ 'saveUserData', 'saveAppdata' ],
		lock: 'lockAppdata',
		unlock: 'unlockAppdata',
	},
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Enforce locking when calling save functions that require file locks',
			category: 'Possible Errors',
			recommended: true,
		},
		fixable: null,
		schema: [
			{
				type: 'object',
				properties: {
					pairs: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								save: {
									oneOf: [
										{ type: 'string' },
										{ type: 'array', items: { type: 'string' } },
									],
								},
								lock: { type: 'string' },
								unlock: { type: 'string' },
							},
							required: [ 'save', 'lock', 'unlock' ],
						},
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			missingLock:
				'Function that calls {{ saveFn }}() must be wrapped with {{ lockFn }}() and {{ unlockFn }}().',
			missingUnlock:
				'{{ lockFn }}() must be followed by {{ unlockFn }}() in a try/finally block.',
		},
	},
	create( context ) {
		const options = context.options[ 0 ] || {};
		const pairs = options.pairs || DEFAULT_PAIRS;

		// Build lookup maps from pairs config
		const saveToLockMap = new Map();
		const lockFunctions = new Set();
		const unlockFunctions = new Set();

		for ( const pair of pairs ) {
			const saveNames = Array.isArray( pair.save ) ? pair.save : [ pair.save ];
			for ( const saveName of saveNames ) {
				saveToLockMap.set( saveName, {
					lock: pair.lock,
					unlock: pair.unlock,
				} );
			}
			lockFunctions.add( pair.lock );
			unlockFunctions.add( pair.unlock );
		}

		const functionStack = [];

		function getCurrentFunction() {
			return functionStack[ functionStack.length - 1 ];
		}

		function enterFunction() {
			functionStack.push( {
				locks: new Set(),
				unlocks: new Set(),
				hasTryFinally: false,
			} );
		}

		function exitFunction( node ) {
			const current = getCurrentFunction();
			if ( current ) {
				for ( const lockFn of current.locks ) {
					const pair = pairs.find( ( p ) => p.lock === lockFn );
					if ( pair && ( ! current.hasTryFinally || ! current.unlocks.has( pair.unlock ) ) ) {
						context.report( {
							node,
							messageId: 'missingUnlock',
							data: { lockFn, unlockFn: pair.unlock },
						} );
					}
				}
			}
			functionStack.pop();
		}

		return {
			CallExpression( node ) {
				const current = getCurrentFunction();
				if ( ! current ) return;

				const calleeName = node.callee.name;

				if ( lockFunctions.has( calleeName ) ) {
					current.locks.add( calleeName );
				}
				if ( unlockFunctions.has( calleeName ) ) {
					current.unlocks.add( calleeName );
				}

				const lockInfo = saveToLockMap.get( calleeName );
				if ( lockInfo && ! current.locks.has( lockInfo.lock ) ) {
					context.report( {
						node,
						messageId: 'missingLock',
						data: {
							saveFn: calleeName,
							lockFn: lockInfo.lock,
							unlockFn: lockInfo.unlock,
						},
					} );
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
