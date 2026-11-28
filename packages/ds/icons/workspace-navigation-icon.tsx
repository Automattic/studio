import type { ComponentProps } from 'react';

const paths = {
	panel:
		'M4 2.5h8A2.5 2.5 0 0 1 14.5 5v6a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 11V5A2.5 2.5 0 0 1 4 2.5Z M4.5 5.25v5.5',
	back: 'M20 12H4M10 18L4 12L10 6',
	forward: 'M4 12H20M14 18L20 12L14 6',
};

export function WorkspaceNavigationIcon( {
	glyph,
	...props
}: ComponentProps< 'svg' > & { glyph: keyof typeof paths } ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox={ glyph === 'panel' ? '0 0 16 16' : '1 1 22 22' }
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d={ paths[ glyph ] } vectorEffect="non-scaling-stroke" />
		</svg>
	);
}
