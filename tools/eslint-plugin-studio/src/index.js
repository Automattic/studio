import importBoundaries from './rules/import-boundaries.js';
import noModuleLevelTranslations from './rules/no-module-level-translations.js';
import noPrimitiveOverrides from './rules/no-primitive-overrides.js';
import useThemeTokens from './rules/use-theme-tokens.js';

export default {
	rules: {
		'import-boundaries': importBoundaries,
		'no-module-level-translations': noModuleLevelTranslations,
		'no-primitive-overrides': noPrimitiveOverrides,
		'use-theme-tokens': useThemeTokens,
	},
};
