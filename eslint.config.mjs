import fs from 'node:fs';
import path from 'node:path';
import css from '@eslint/css';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginImport from 'eslint-plugin-import-x';
import pluginJestDom from 'eslint-plugin-jest-dom';
import pluginPrettier from 'eslint-plugin-prettier/recommended';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tsEslint from 'typescript-eslint';
import pluginStudio from 'eslint-plugin-studio';

const WP_UI_PACKAGES = {
	group: [ 'components', 'dataviews', 'theme', 'ui' ].flatMap( ( name ) => [
		`@wordpress/${ name }`,
		`@wordpress/${ name }/*`,
	] ),
	message: 'Use the primitives in @/lib/ui and the tokens in @/lib/theme.',
};

// `apps/ui/src` is layered as internal packages (`lib/*`), product areas (`features/*`),
// then `data/`, `router/` and `app/`. See apps/ui/README.md.
const UI_SRC = path.join( import.meta.dirname, 'apps/ui/src' );
const uiDirs = ( dir ) =>
	fs
		.readdirSync( path.join( UI_SRC, dir ), { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => `${ dir }/${ entry.name }` );
const UI_LIB = uiDirs( 'lib' );
const UI_FEATURES = uiDirs( 'features' );
const uiPath = ( p ) => path.join( UI_SRC, p );
const UI_LAYERS = {
	zones: [
		...UI_LIB.map( ( pkg ) => ( {
			target: [
				...fs.readdirSync( UI_SRC ).filter( ( name ) => name !== 'lib' ),
				...UI_LIB.filter( ( other ) => other !== pkg ),
			].map( uiPath ),
			from: uiPath( pkg ),
			except: [ './index.ts', ...( pkg === 'lib/theme' ? [ './tokens.css', './base.css' ] : [] ) ],
			message: `Import from @/${ pkg }, its public entry.`,
		} ) ),
		{
			target: uiPath( 'lib' ),
			from: [ 'features', 'data', 'router', 'app' ].map( uiPath ),
			message: 'lib/ packages stay independent of the app.',
		},
		{
			target: [ 'lib', 'data', 'main.tsx', 'main.local.tsx' ].map( uiPath ),
			from: uiPath( 'features' ),
			message: 'Only router/, app/ and other features import features.',
		},
		...UI_FEATURES.map( ( feature ) => ( {
			target: [ 'router', 'app', ...UI_FEATURES.filter( ( other ) => other !== feature ) ].map(
				uiPath
			),
			from: uiPath( feature ),
			except: [ './index.ts' ],
			message: `Import from @/${ feature }, its public entry.`,
		} ) ),
	],
};

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
	{
		files: [ '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}' ],
		extends: [
			js.configs.recommended,
			tsEslint.configs.recommended,
			pluginImport.flatConfigs.recommended,
			pluginImport.flatConfigs.electron,
			pluginImport.flatConfigs.typescript,
			pluginPrettier,
			pluginReactHooks.configs.flat.recommended,
			pluginJestDom.configs[ 'flat/recommended' ],
		],
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
						'apps/mcp-ui/vite.config.ts',
						'plugins/wp-studio/scripts/*.mjs',
						'apps/ui/vite.config.ts',
						'apps/ui/vitest.setup.ts',
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
						path.join( import.meta.dirname, 'apps/mcp-ui/tsconfig.json' ),
						path.join( import.meta.dirname, 'apps/ui/tsconfig.json' ),
						path.join( import.meta.dirname, 'packages/common/tsconfig.json' ),
						path.join( import.meta.dirname, 'packages/design-md/tsconfig.json' ),
						path.join( import.meta.dirname, 'tools/compare-perf/tsconfig.json' ),
						path.join( import.meta.dirname, 'tools/metrics/tsconfig.json' ),
					],
				},
			},
		},
		rules: {
			// Temporarily disabled after the ESLint 10 upgrade, which promoted these to `recommended`.
			// Enabling them and fixing the existing violations is tracked in STU-2175.
			'no-useless-assignment': 'off',
			'preserve-caught-error': 'off',
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
			'studio/no-module-level-translations': 'error',
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
	},
	{
		// Module-level translations can't go stale in the CLI: it is a one-shot
		// process that loads the locale before importing modules.
		files: [ 'apps/cli/**' ],
		rules: {
			'studio/no-module-level-translations': 'off',
		},
	},
	{
		// The agentic UI owns its design system: theme tokens in `src/lib/theme/` and
		// primitives in `src/lib/ui/`, which stay independent of app code.
		files: [ 'apps/ui/src/**/*.{ts,tsx}' ],
		rules: {
			'no-restricted-imports': [ 'error', { patterns: [ WP_UI_PACKAGES ] } ],
			'import-x/no-restricted-paths': [ 'error', UI_LAYERS ],
			'import-x/no-cycle': 'error',
		},
	},
	{
		files: [ 'apps/ui/src/lib/**/*.{ts,tsx}' ],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						WP_UI_PACKAGES,
						{ group: [ '@tanstack/*' ], message: 'lib/ packages stay independent of app code.' },
					],
				},
			],
		},
	},
	{
		// These tests assert on the `aria-valuenow` attribute of ARIA range widgets
		// (slider/separator/progressbar elements). eslint-plugin-jest-dom 5.10 flags
		// those `toHaveAttribute` calls and autofixes them to `toHaveValue()`, which only
		// reads the form `value` property and returns undefined for these non-form elements.
		files: [ 'apps/ui/**/*.test.{ts,tsx}' ],
		rules: {
			'jest-dom/prefer-to-have-value': 'off',
		},
	},
	{
		files: [ 'apps/ui/src/**/*.css' ],
		plugins: { css, prettier: pluginPrettier.plugins.prettier, studio: pluginStudio },
		language: 'css/css',
		languageOptions: { tolerant: true },
		rules: {
			'prettier/prettier': 'error',
			'studio/use-theme-tokens': 'error',
		},
	},
	{
		// Tokens are defined here, and the onboarding illustrations are artwork drawn
		// with their own literal values.
		files: [ 'apps/ui/src/lib/theme/**', 'apps/ui/src/features/onboarding/onboarding-guide/illustrations/**' ],
		rules: {
			'studio/use-theme-tokens': 'off',
		},
	}
);
