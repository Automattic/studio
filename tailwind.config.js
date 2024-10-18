/** @type {import('tailwindcss').Config} */
import palette from '@automattic/color-studio';
import plugin from 'tailwindcss/plugin';
import { WINDOWS_TITLEBAR_HEIGHT, MAIN_MIN_WIDTH } from './src/constants.ts';

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

// This colors are in the palette but not included because the color name contains more than one word.
// Reference: https://github.com/Automattic/color-studio/blob/55218ffdaecc770cd697639071f1d2083f744f66/dist/colors.json#L123-L187
a8cToTailwindColors[ `${ PREFIX }-blueberry-5` ] = '#F7F8FE'; // WordPress Blue 5
a8cToTailwindColors[ `${ PREFIX }-blueberry` ] = '#3858E9'; // WordPress Blue
a8cToTailwindColors[ `${ PREFIX }-blueberry-70` ] = '#1d35b4'; // WordPress Blue 70

module.exports = {
	content: [ './src/**/*.{html,ejs,js,jsx,ts,tsx}' ],
	theme: {
		extend: {
			colors: {
				...a8cToTailwindColors,
				chrome: 'rgba(30, 30, 30, 1)',
				'chrome-inverted': '#fff',
			},
			spacing: {
				chrome: '10px',
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
