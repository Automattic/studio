import noModuleLevelTranslations from './rules/no-module-level-translations.js';
import noPrimitiveOverrides from './rules/no-primitive-overrides.js';
import requireLockBeforeSave from './rules/require-lock-before-save.js';
import useThemeTokens from './rules/use-theme-tokens.js';

export default {
	rules: {
		'require-lock-before-save': requireLockBeforeSave,
		'no-module-level-translations': noModuleLevelTranslations,
		'no-primitive-overrides': noPrimitiveOverrides,
		'use-theme-tokens': useThemeTokens,
	},
};
