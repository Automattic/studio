import type { ComponentProps } from 'react';

export function DuplicateIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 256 256"
			fill="none"
			stroke="currentColor"
			strokeWidth="20"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d="M88 80V52a12 12 0 0 1 12-12H204a12 12 0 0 1 12 12V156a12 12 0 0 1-12 12H176" />
			<rect x="40" y="88" width="128" height="128" rx="12" />
		</svg>
	);
}
