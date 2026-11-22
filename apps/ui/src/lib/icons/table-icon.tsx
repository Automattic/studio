import type { ComponentProps } from 'react';

export function TableIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 256 256"
			fill="currentColor"
			aria-hidden="true"
			{ ...props }
		>
			<path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM40,112H80v32H40Zm56,0H216v32H96ZM216,64V96H40V64ZM40,160H80v32H40Zm176,32H96V160H216v32Z" />
		</svg>
	);
}
