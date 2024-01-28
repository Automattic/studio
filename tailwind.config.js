/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [ './src/**/*.{html,js,jsx,ts,tsx}' ],
	theme: {
		extend: {
			colors: {
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
