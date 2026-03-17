import { defineConfig, globalIgnores } from 'eslint/config';
import pluginImport from 'eslint-plugin-import-x';
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
			'import-x/resolver': {
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
			'import-x/no-named-as-default-member': 'off',
			// @wp-playground/blueprints ships blueprint-schema-validator outside its package.json exports map
			'import-x/no-unresolved': [ 'error', { ignore: [ '@wp-playground/blueprints/blueprint-schema-validator' ] } ],
			'import-x/order': [
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
	},
	{
		files: [ 'apps/cli/**/*.{ts,tsx}' ],
		ignores: [ 'apps/cli/vite.config*.ts', 'apps/cli/vitest.config.ts' ],
		rules: {
			'no-restricted-globals': [
				'error',
				{
					name: '__dirname',
					message: 'Use import.meta.dirname in ESM modules.',
				},
				{
					name: '__filename',
					message: 'Use import.meta.filename in ESM modules.',
				},
			],
		},
	}
);
