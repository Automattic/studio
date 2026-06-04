import noRedundantCx from './rules/no-redundant-cx.js';
import requireLockBeforeSave from './rules/require-lock-before-save.js';

export default {
	rules: {
		'no-redundant-cx': noRedundantCx,
		'require-lock-before-save': requireLockBeforeSave,
	},
};
