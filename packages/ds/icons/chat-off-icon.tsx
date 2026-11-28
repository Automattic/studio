import type { ComponentProps } from 'react';

export function ChatOffIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path
				vectorEffect="non-scaling-stroke"
				d="M4.92915 4.92892C3.1195 6.73857 2.00021 9.23857 2.00021 12C2.00021 13.5997 2.37583 15.1116 3.04367 16.4525C3.22115 16.8088 3.28022 17.2161 3.17733 17.6006L2.58172 19.8266C2.32317 20.793 3.20723 21.677 4.17356 21.4185L6.3996 20.8229C6.78415 20.72 7.19142 20.7791 7.54774 20.9565C8.88858 21.6244 10.4005 22 12.0002 22C14.7616 22 17.2616 20.8807 19.0713 19.0711"
			/>
			<path
				vectorEffect="non-scaling-stroke"
				d="M6.862 3.41914C8.36362 2.51807 10.1213 2 12 2C17.5228 2 22 6.47715 22 12C22 13.8787 21.4819 15.6364 20.5809 17.138"
			/>
			<path vectorEffect="non-scaling-stroke" d="M2 2L22 22" />
		</svg>
	);
}
