/** @type {import('tailwindcss').Config} */
import path from 'node:path';
import palette from '@automattic/color-studio';
import plugin from 'tailwindcss/plugin';
import { WINDOWS_TITLEBAR_HEIGHT, MAIN_MIN_WIDTH, APP_CHROME_SPACING } from './src/constants.ts';

const BASE_FONT_SIZE = 16; // 1 rem
const pxToRem = ( px ) => `${ px / BASE_FONT_SIZE }rem`;
const typographyStyles = {
	'title-large': {
		fontSize: pxToRem( 32 ),
		fontWeight: '400',
		lineHeight: pxToRem( 40 ),
		textTransform: 'normal',
		letterSpacing: pxToRem( 0 ),
	},
	'title-medium': {
		fontSize: pxToRem( 24 ),
		fontWeight: '400',
		lineHeight: pxToRem( 32 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'title-small': {
		fontSize: pxToRem( 20 ),
		fontWeight: '400',
		lineHeight: pxToRem( 28 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	subtitle: {
		fontSize: pxToRem( 16 ),
		fontWeight: '600',
		lineHeight: pxToRem( 24 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'subtitle-small': {
		fontSize: pxToRem( 14 ),
		fontWeight: '600',
		lineHeight: pxToRem( 20 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	body: {
		fontSize: pxToRem( 13 ),
		fontWeight: '400',
		lineHeight: pxToRem( 20 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	button: {
		fontSize: pxToRem( 13 ),
		fontWeight: '400',
		lineHeight: pxToRem( 13 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	label: {
		fontSize: pxToRem( 11 ),
		fontWeight: '500',
		lineHeight: pxToRem( 16 ),
		textTransform: 'uppercase',
		letterSpacing: pxToRem( 0 ),
	},
	'label-semibold': {
		fontSize: pxToRem( 13 ),
		fontWeight: '600',
		lineHeight: pxToRem( 16 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'link-text': {
		fontSize: pxToRem( 13 ),
		fontWeight: '400',
		lineHeight: pxToRem( 16 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	placeholder: {
		fontSize: pxToRem( 13 ),
		fontWeight: '400',
		lineHeight: pxToRem( 16 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'body-small': {
		fontSize: pxToRem( 12 ),
		fontWeight: '400',
		lineHeight: pxToRem( 16 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'helper-text': {
		fontSize: pxToRem( 12 ),
		fontWeight: '400',
		lineHeight: pxToRem( 16 ),
		textTransform: 'initial',
		letterSpacing: pxToRem( 0 ),
	},
	'small-button-text': {
		fontSize: pxToRem( 11 ),
		fontWeight: '400',
		lineHeight: pxToRem( 16 ),
		textTransform: 'uppercase',
		letterSpacing: pxToRem( 0 ),
	},
	'section-heading': {
		fontSize: pxToRem( 11 ),
		fontWeight: '500',
		lineHeight: pxToRem( 16 ),
		textTransform: 'uppercase',
		letterSpacing: pxToRem( 0 ),
	},
};

let a8cToTailwindColors = {};
const PREFIX = 'a8c';

for ( const [ key, value ] of Object.entries( palette.colors ) ) {
	let [ colorName, shade ] = key.split( ' ' );
	colorName = `${ PREFIX }-${ colorName.toLowerCase() }`;
	shade = shade?.toLowerCase() || 'DEFAULT';

	if ( ! a8cToTailwindColors[ colorName ] ) {
		a8cToTailwindColors[ colorName ] = {};
	}
	a8cToTailwindColors[ colorName ][ shade ] = value;
}

// These colors are not in the color studio but are used in the design system.
// Reference: https://github.com/WordPress/gutenberg/blob/trunk/packages/base-styles/_colors.scss
a8cToTailwindColors[ `${ PREFIX }-gray-900` ] = '#1e1e1e'; // Gray 900
a8cToTailwindColors[ `${ PREFIX }-gray-800` ] = '#2F2F2F'; // Gray 800
a8cToTailwindColors[ `${ PREFIX }-gray-700` ] = '#757575'; // Gray 700
a8cToTailwindColors[ `${ PREFIX }-gray-400` ] = '#CCC'; // Gray 400
a8cToTailwindColors[ `${ PREFIX }-gray-600` ] = '#949494'; // Gray 600
a8cToTailwindColors[ `${ PREFIX }-gray-100` ] = '#f0f0f0'; // Gray 100
a8cToTailwindColors[ `${ PREFIX }-gray-5` ] = '#DCDCDE'; // Gray 5

module.exports = {
	content: [
		path.join( __dirname, 'index.html' ),
		path.join( __dirname, 'src/**/*.{html,js,jsx,ts,tsx}' ),
	],
	theme: {
		extend: {
			colors: {
				...a8cToTailwindColors,
				chrome: 'rgba(30, 30, 30, 1)',
				'chrome-inverted': '#fff',
				'development-bg': 'hsl(200, 95%, 85%)',
				'development-text': 'hsl(200, 95%, 28%)',
				'circle-env-production': '#069e08',
				'circle-env-staging': '#f7ba42',
				// Content frame colors (CSS custom properties, swap in dark mode)
				frame: 'var(--color-frame-bg)',
				'frame-text': 'var(--color-frame-text)',
				'frame-text-secondary': 'var(--color-frame-text-secondary)',
				'frame-border': 'var(--color-frame-border)',
				'frame-surface': 'var(--color-frame-surface)',
				'frame-surface-alt': 'var(--color-frame-surface-alt)',
				'frame-theme': 'var(--color-frame-theme)',
				'frame-theme-hover': 'var(--color-frame-theme-hover)',
				'frame-code-text': 'var(--color-frame-code-text)',
				'frame-running': 'var(--color-frame-running)',
				'frame-error': 'var(--color-frame-error)',
				'frame-tab-active': 'var(--color-frame-tab-active)',
			},
			spacing: {
				chrome: `${ APP_CHROME_SPACING }px`,
				sidebar: '6px',
				'sidebar-mac': '10px',
				'titlebar-win': `${ WINDOWS_TITLEBAR_HEIGHT }px`,
				'window-controls-width-win': '138px',
				'window-controls-width-excl-chrome-win': '128px', // Subtract 10px for the chrome
				'window-controls-width-mac': '80px',
				'window-controls-width-excl-chrome-mac': '70px', // Subtract 10px for the chrome
			},
			borderRadius: {
				chrome: '5px',
			},
			fontSize: {
				xxs: '0.6875rem',
				body: '0.8125rem',
			},
			keyframes: {
				fade: {
					from: { opacity: 0 },
					to: { opacity: 1 },
				},
				'slow-spin': {
					from: { transform: 'rotate(0deg)' },
					to: { transform: 'rotate(360deg)' },
				},
				'arrow-nudge': {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(2px)' },
				},
				'gentle-pulse': {
					'0%, 100%': { opacity: '0.5' },
					'50%': { opacity: '1' },
				},
				'card-shift': {
					'0%, 100%': { transform: 'translate(0, 0)' },
					'50%': { transform: 'translate(-3px, -3px)' },
				},
			},
			animation: {
				'slow-spin': 'slow-spin 20s linear infinite',
				'slow-spin-reverse': 'slow-spin 24s linear infinite reverse',
				'arrow-nudge': 'arrow-nudge 1.2s ease-in-out infinite',
				'gentle-pulse': 'gentle-pulse 3s ease-in-out infinite',
				'card-shift': 'card-shift 3s ease-in-out infinite',
			},
			screens: {
				sd: `${ MAIN_MIN_WIDTH }px`,
			},
			height: {
				4.5: '1.125rem',
			},
		},
	},
	plugins: [
		plugin( function ( { addComponents, e } ) {
			const newComponents = Object.entries( typographyStyles ).reduce( ( acc, [ key, value ] ) => {
				const name = `.${ e( `${ PREFIX }-${ key }` ) }`; // e.g. .a8c-title-large
				acc[ name ] = {
					fontSize: value.fontSize,
					fontWeight: value.fontWeight,
					lineHeight: value.lineHeight,
					textTransform: value.textTransform,
					letterSpacing: value.letterSpacing,
				};
				return acc;
			}, {} );

			addComponents( newComponents );
		} ),
	],
};
