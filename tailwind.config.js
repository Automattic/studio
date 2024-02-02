/** @type {import('tailwindcss').Config} */
import palette from '@automattic/color-studio';

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

module.exports = {
	content: [ './src/**/*.{html,js,jsx,ts,tsx}' ],
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
			},
			borderRadius: {
				chrome: '5px',
			},
		},
	},
	plugins: [],
};
