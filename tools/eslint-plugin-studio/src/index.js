import noModuleLevelTranslations from './rules/no-module-level-translations.js';
import requireLockBeforeSave from './rules/require-lock-before-save.js';

export default {
	rules: {
		'require-lock-before-save': requireLockBeforeSave,
		'no-module-level-translations': noModuleLevelTranslations,
	},
};
