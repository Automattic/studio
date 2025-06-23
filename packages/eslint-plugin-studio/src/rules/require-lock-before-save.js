module.exports = {
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
      missingLock: 'Function that calls saveUserData() or saveAppdata() must be wrapped with lockAppdata() and unlockAppdata().',
      missingUnlock: 'lockAppdata() must be followed by unlockAppdata() in a try/finally block.',
    },
  },
  create(context) {
    const saveFunctions = ['saveUserData', 'saveAppdata'];
    let hasLockCall = false;
    let hasUnlockCall = false;
    let isInFunction = false;
    let hasTryFinally = false;

    return {
      CallExpression(node) {
        if (node.callee.name === 'lockAppdata') {
          hasLockCall = true;
        }
        if (node.callee.name === 'unlockAppdata') {
          hasUnlockCall = true;
        }

        // Any call to saveUserData or saveAppdata requires lock
        if (saveFunctions.includes(node.callee.name) && isInFunction) {
          if (!hasLockCall) {
            context.report({
              node,
              messageId: 'missingLock',
            });
          }
        }
      },
      TryStatement(node) {
        if (node.finalizer) {
          hasTryFinally = true;
        }
      },
      FunctionDeclaration() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
      'FunctionDeclaration:exit'() {
        if (hasLockCall && (!hasTryFinally || !hasUnlockCall)) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: 'missingUnlock',
          });
        }
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
      ArrowFunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
      'ArrowFunctionExpression:exit'() {
        if (hasLockCall && (!hasTryFinally || !hasUnlockCall)) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: 'missingUnlock',
          });
        }
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
      FunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
      'FunctionExpression:exit'() {
        if (hasLockCall && (!hasTryFinally || !hasUnlockCall)) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: 'missingUnlock',
          });
        }
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
      },
    };
  },
};