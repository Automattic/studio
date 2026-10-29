import type { ComponentProps } from 'react';

export function ChatIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d="M3 20H16C18.7614 20 21 17.7614 21 15V9C21 6.23858 18.7614 4 16 4H8C5.23858 4 3 6.23858 3 9V20Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
