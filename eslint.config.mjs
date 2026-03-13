import { defineConfig, globalIgnores } from 'eslint/config';
import pluginImport from 'eslint-plugin-import';
import pluginStudio from 'eslint-plugin-studio';
import pluginPrettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tsEslint from 'typescript-eslint';
import js from '@eslint/js';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginJestDom from 'eslint-plugin-jest-dom';
import path from 'node:path';

export default defineConfig(
	globalIgnores( [
		'**/node_modules/',
		'**/__mocks__',
		'apps/cli/dist/',
		'dist/',
		'out/',
		'vendor/',
		'wp-files/',
	] ),
	js.configs.recommended,
	tsEslint.configs.recommended,
	pluginImport.flatConfigs.recommended,
	pluginImport.flatConfigs.electron,
	pluginImport.flatConfigs.typescript,
	pluginPrettier,
	pluginReactHooks.configs.flat.recommended,
	pluginJestDom.configs[ 'flat/recommended' ],
	{
		plugins: {
			studio: pluginStudio,
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			sourceType: 'commonjs',
			parserOptions: {
				projectService: true,
			},
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: [
						path.join( import.meta.dirname, 'tsconfig.json' ),
						path.join( import.meta.dirname, 'apps/cli/tsconfig.json' ),
						path.join( import.meta.dirname, 'apps/studio/tsconfig.json' ),
						path.join( import.meta.dirname, 'tools/common/tsconfig.json' ),
						path.join( import.meta.dirname, 'tools/compare-perf/tsconfig.json' ),
						path.join( import.meta.dirname, 'tools/metrics/tsconfig.json' ),
					],
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
			'studio/require-lock-before-save': [
				'error',
				{
					pairs: [
						{
							save: [ 'saveUserData', 'saveAppdata' ],
							lock: 'lockAppdata',
							unlock: 'unlockAppdata',
						},
						{
							save: 'saveCliConfig',
							lock: 'lockCliConfig',
							unlock: 'unlockCliConfig',
						},
					],
				},
			],
		},
	},
	{
		files: [ '**/*.ts', 'src/tests/**/*.{ts,tsx}' ],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	}
);
