import type { ComponentProps } from 'react';

export function ShuffleIcon( props: ComponentProps< 'svg' > ) {
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
				d="M3 18H4.58579C4.851 18 5.10536 17.8946 5.29289 17.7071L15.7071 7.29289C15.8946 7.10536 16.149 7 16.4142 7H19M3 6H4.58579C4.851 6 5.10536 6.10536 5.29289 6.29289L8 9M19 17H16.4142C16.149 17 15.8946 16.8946 15.7071 16.7071L14 15M18 4L21 7L18 10M18 14L21 17L18 20"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
