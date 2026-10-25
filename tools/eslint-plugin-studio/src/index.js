import noModuleLevelTranslations from './rules/no-module-level-translations.js';
import requireLockBeforeSave from './rules/require-lock-before-save.js';
import useThemeTokens from './rules/use-theme-tokens.js';

export default {
	rules: {
		'require-lock-before-save': requireLockBeforeSave,
		'no-module-level-translations': noModuleLevelTranslations,
		'use-theme-tokens': useThemeTokens,
	},
};
