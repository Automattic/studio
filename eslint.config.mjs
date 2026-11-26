// ESLint checks only the stylesheets; oxlint (`.oxlintrc.json`) checks the code.
import fs from 'node:fs';
import path from 'node:path';
import css from '@eslint/css';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginPrettier from 'eslint-plugin-prettier/recommended';
import pluginStudio from 'eslint-plugin-studio';

const DS = path.join( import.meta.dirname, 'packages/ds' );

// Custom properties the primitives use, beyond the theme tokens. Feature CSS may
// set only the documented hooks (see packages/ds/primitives/README.md).
const cssCustomProperties = ( dir ) =>
	fs
		.readdirSync( path.join( DS, dir ), { recursive: true } )
		.filter( ( file ) => file.endsWith( '.css' ) )
		.flatMap(
			( file ) => fs.readFileSync( path.join( DS, dir, file ), 'utf8' ).match( /--[\w-]+/g ) ?? []
		);
const THEME_TOKENS = cssCustomProperties( 'theme' );
const PRIMITIVE_HOOKS = [
	'--app-icon-size',
	'--button-background',
	'--button-hover-background',
	'--button-hover-color',
	'--radius-button',
];
const PRIMITIVE_PROPERTIES = [ ...new Set( cssCustomProperties( 'primitives' ) ) ].filter(
	( property ) => ! THEME_TOKENS.includes( property ) && ! PRIMITIVE_HOOKS.includes( property )
);

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
		files: [ 'apps/ui/src/**/*.css', 'packages/ds/**/*.css', 'packages/providers/**/*.css' ],
		plugins: { css, prettier: pluginPrettier.plugins.prettier, studio: pluginStudio },
		language: 'css/css',
		languageOptions: { tolerant: true },
		rules: {
			'prettier/prettier': 'error',
			'studio/use-theme-tokens': 'error',
			'css/no-important': 'error',
		},
	},
	{
		files: [ 'apps/ui/src/**/*.css' ],
		rules: {
			'studio/no-primitive-overrides': [ 'error', { properties: PRIMITIVE_PROPERTIES } ],
		},
	},
	{
		// The reduced-transparency reset has to beat class-scoped rules, and Shiki
		// colors code tokens with inline styles.
		files: [ 'packages/ds/theme/base.css', 'packages/ds/primitives/code-block/style.module.css' ],
		rules: {
			'css/no-important': 'off',
		},
	},
	{
		// Tokens are defined in the theme. The onboarding illustrations and Wapuu World
		// are artwork drawn with their own values, and the design system view renders
		// a site's own type, colors and radii.
		files: [
			'packages/ds/theme/**',
			'apps/ui/src/features/onboarding/onboarding-guide/illustrations/**',
			'apps/ui/src/features/settings/wapuu-world/**',
			'apps/ui/src/features/sites/design-system-view/**',
		],
		rules: {
			'studio/use-theme-tokens': 'off',
		},
	}
);
