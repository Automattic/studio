import path from 'node:path';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginImport from 'eslint-plugin-import-x';
import pluginJestDom from 'eslint-plugin-jest-dom';
import pluginPrettier from 'eslint-plugin-prettier/recommended';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tsEslint from 'typescript-eslint';
import pluginStudio from 'eslint-plugin-studio';

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
				projectService: {
					allowDefaultProject: [
						'apps/studio/forge.config.ts',
						'apps/studio/windowsSign.ts',
						'apps/studio/tailwind.config.js',
						'apps/ui/vite.config.ts',
						'eslint.config.mjs',
						'vitest.config.ts',
						'tools/eslint-plugin-studio/vitest.config.ts',
						'tools/eslint-plugin-studio/src/index.js',
						'tools/eslint-plugin-studio/src/rules/*.js',
						'tools/eslint-plugin-studio/tests/*.ts',
					],
				},
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
						path.join( import.meta.dirname, 'apps/ui/tsconfig.json' ),
						path.join( import.meta.dirname, 'packages/common/tsconfig.json' ),
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
			// @wp-playground/blueprints ships blueprint-schema-validator outside its package.json exports map.
			// @modelcontextprotocol/sdk 1.29+ only exposes server/stdio.js via a wildcard export which the
			// eslint-import-x typescript resolver can't follow (runtime resolution is fine).
			'import-x/no-unresolved': [
				'error',
				{
					ignore: [
						'@wp-playground/blueprints/blueprint-schema-validator',
						'@modelcontextprotocol/sdk/server/stdio\\.js$',
						'@modelcontextprotocol/sdk/client/index\\.js$',
						'@modelcontextprotocol/sdk/client/stdio\\.js$',
					],
				},
			],
			'import-x/order': [
				'error',
				{
					'newlines-between': 'never',
					alphabetize: { order: 'asc' },
					groups: [ 'builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type' ],
				},
			],
			'react-hooks/set-state-in-effect': 'off',
			'studio/no-redundant-cx': 'error',
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
						{
							save: 'saveSharedConfig',
							lock: 'lockSharedConfig',
							unlock: 'unlockSharedConfig',
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
	},
	{
		files: [ 'scripts/**/*.js', 'scripts/**/*.cjs' ],
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
	},
	{
		files: [ 'scripts/**/*.mjs' ],
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
