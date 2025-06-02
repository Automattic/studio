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
    let isInTryBlock = false;
    let isModifyingDerivedData = false;

    // Helper to check if we're modifying derived data
    function checkForDerivedDataModification(node) {
      // Check for array modifications (push, splice, etc.)
      if (node.type === 'CallExpression' && 
          node.callee.type === 'MemberExpression' &&
          ['push', 'splice', 'pop', 'shift', 'unshift'].includes(node.callee.property.name)) {
        return true;
      }

      // Check for direct array element modifications
      if (node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression' &&
          node.left.property.type === 'Identifier') {
        return true;
      }

      // Check for object property modifications
      if (node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression' &&
          node.left.object.type === 'Identifier') {
        const objectName = node.left.object.name;
        // List of objects that contain derived data
        const derivedDataObjects = ['sites', 'snapshots', 'data'];
        if (derivedDataObjects.includes(objectName)) {
          return true;
        }
      }

      return false;
    }

    return {
      CallExpression(node) {
        if (node.callee.name === 'lockAppdata') {
          hasLockCall = true;
          if (!isInTryBlock) {
            context.report({
              node,
              messageId: 'missingUnlock',
            });
          }
        }
        if (node.callee.name === 'unlockAppdata') {
          hasUnlockCall = true;
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
      TryStatement() {
        isInTryBlock = true;
      },
      'TryStatement:exit'() {
        isInTryBlock = false;
      },
      FunctionDeclaration() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
      'FunctionDeclaration:exit'() {
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
      ArrowFunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
      'ArrowFunctionExpression:exit'() {
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
      FunctionExpression() {
        isInFunction = true;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
      'FunctionExpression:exit'() {
        isInFunction = false;
        hasLockCall = false;
        hasUnlockCall = false;
        isModifyingDerivedData = false;
      },
    };
  },
}; 
