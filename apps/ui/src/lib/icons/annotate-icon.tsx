import type { ComponentProps } from 'react';

export function AnnotateIcon( props: ComponentProps< 'svg' > ) {
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
				d="M20 10V7C20 5.34315 18.6569 4 17 4H7C5.34315 4 4 5.34315 4 7V17C4 18.6569 5.34315 20 7 20H10M14.1879 20.8366L11.9746 12.5871C11.8748 12.2152 12.2152 11.8748 12.5871 11.9746L20.8366 14.1879C21.2665 14.3032 21.3428 14.8805 20.9576 15.1035L17.3077 17.2166C17.2699 17.2385 17.2385 17.2699 17.2166 17.3077L15.1035 20.9576C14.8805 21.3428 14.3032 21.2665 14.1879 20.8366Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
