import type { ComponentProps } from 'react';

export function WhatsNewIcon( props: ComponentProps< 'svg' > ) {
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
				d="M12 3C12 9.59722 9.25 12.5 3 12.5C9.25 12.5 12 15.4028 12 22C12 15.4028 14.75 12.5 21 12.5C14.75 12.5 12 9.59722 12 3Z"
				strokeWidth="2"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
