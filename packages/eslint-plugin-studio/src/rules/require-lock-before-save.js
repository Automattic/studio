module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce locking when modifying derived data',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      missingLock: 'Function that modifies derived data (sites array, etc.) must be wrapped with lockAppdata() and unlockAppdata().',
      missingUnlock: 'lockAppdata() must be followed by unlockAppdata() in a try/finally block.',
    },
  },
  create(context) {
    const saveFunctions = ['saveUserData', 'saveAppdata'];
    let hasLockCall = false;
    let hasUnlockCall = false;
    let isInFunction = false;
    let hasTryFinally = false;
    let isModifyingDerivedData = false;

    // Helper to check if we're modifying derived data
    function checkForDerivedDataModification(node) {
      // Check for array modifications (push, splice, etc.) on data objects
      if (node.type === 'CallExpression' && 
          node.callee.type === 'MemberExpression' &&
          ['push', 'splice', 'pop', 'shift', 'unshift'].includes(node.callee.property.name)) {
        // Check if we're calling these methods on a data object property
        if (node.callee.object.type === 'MemberExpression' &&
            node.callee.object.object.name === 'data') {
          return true;
        }
      }

      // Check for direct property modifications on data objects
      if (node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression') {
        // Check if we're modifying properties of a data object
        let current = node.left;
        while (current.object) {
          if (current.object.name === 'data') {
            return true;
          }
          if (current.object.type === 'MemberExpression') {
            current = current.object;
          } else {
            break;
          }
        }
      }

      return false;
    }

    return {
      CallExpression(node) {
        if (node.callee.name === 'lockAppdata') {
          hasLockCall = true;
        }
        if (node.callee.name === 'unlockAppdata') {
          hasUnlockCall = true;
        }
        
        // Check for array method calls that modify data
        if (isInFunction && checkForDerivedDataModification(node)) {
          isModifyingDerivedData = true;
        }
        
        if (saveFunctions.includes(node.callee.name)) {
          if (!hasLockCall && isInFunction && isModifyingDerivedData) {
            context.report({
              node,
              messageId: 'missingLock',
            });
          }
        }
      },
      AssignmentExpression(node) {
        if (isInFunction) {
          isModifyingDerivedData = isModifyingDerivedData || checkForDerivedDataModification(node);
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
        isModifyingDerivedData = false;
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
        isModifyingDerivedData = false;
      },
      ArrowFunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
        isModifyingDerivedData = false;
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
        isModifyingDerivedData = false;
      },
      FunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        hasTryFinally = false;
        isModifyingDerivedData = false;
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
        isModifyingDerivedData = false;
      },
    };
  },
}; 
