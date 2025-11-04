import { defineConfig, globalIgnores } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import studio from 'eslint-plugin-studio';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tsEslint from 'typescript-eslint';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
	globalIgnores( [ '**/node_modules/', '**/dist/', '**/out/', '**/wp-files/', '**/vendor/' ] ),
	js.configs.recommended,
	tsEslint.configs.recommended,
	importPlugin.flatConfigs.recommended,
	importPlugin.flatConfigs.electron,
	importPlugin.flatConfigs.typescript,
	eslintPluginPrettierRecommended,
	reactHooks.configs.flat.recommended,
	{
		plugins: {
			studio: studio,
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			ecmaVersion: 5,
			sourceType: 'commonjs',
			parserOptions: {
				projectService: true,
			},
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
				},
			},
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-explicit-any': [ 'error', { ignoreRestArgs: true } ],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					args: 'after-used',
					argsIgnorePattern: '^_',
					caughtErrors: 'none',
					ignoreRestSiblings: true,
					vars: 'all',
					varsIgnorePattern: '^_',
				},
			],
			'import/no-named-as-default-member': 'off',
			'import/order': [
				'error',
				{
					'newlines-between': 'never',
					alphabetize: { order: 'asc' },
					groups: [ 'builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type' ],
				},
			],
			'react-hooks/set-state-in-effect': 'off',
			'studio/require-lock-before-save': 'error',
		},
	},
	{
		files: [ '**/*.ts', 'src/tests/**/*.{ts,tsx}' ],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	}
);
