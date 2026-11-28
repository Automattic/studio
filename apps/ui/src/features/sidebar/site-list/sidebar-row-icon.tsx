import type { ComponentProps } from 'react';

const glyphs = {
	site: {
		viewBox: '-1 -1 26 26',
		path: 'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0Z M16 12a4 10 0 1 1-8 0 4 10 0 1 1 8 0Z M2 12h20',
	},
	compose: {
		viewBox: '0 0 16 16',
		path: 'M8 2H5.25a3 3 0 0 0-3 3v6.25a3 3 0 0 0 3 3h5.5a3 3 0 0 0 3-3V8 M6.25 10l.75-3 4.75-4.75a1.42 1.42 0 0 1 2 2L9 9Z',
	},
	archive: {
		viewBox: '0 0 16 16',
		path: 'M3 5.5v5.25a2.75 2.75 0 0 0 2.75 2.75h4.5A2.75 2.75 0 0 0 13 10.75V5.5 M6.5 8.5h3 M3 2.5h10a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1Z',
	},
	start: {
		viewBox: '0 0 16 16',
		path: 'M3.5 4c0-1.3 1.4-2.1 2.5-1.4l6.2 4c1 .65 1 2.15 0 2.8l-6.2 4c-1.1.7-2.5-.1-2.5-1.4Z',
	},
	stop: {
		viewBox: '-4 -4 32 32',
		path: 'M12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22Z',
	},
	add: { viewBox: '0 0 16 16', path: 'M2.5 7.5h10m-5-5v10' },
};

export function SidebarRowIcon( {
	glyph,
	...props
}: ComponentProps< 'svg' > & { glyph: keyof typeof glyphs } ) {
	const { viewBox, path } = glyphs[ glyph ];
	return (
		<svg
			width="16"
			height="16"
			viewBox={ viewBox }
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d={ path } vectorEffect="non-scaling-stroke" />
		</svg>
	);
}
