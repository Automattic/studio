import type { ComponentProps } from 'react';

export function UnpinIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d="M7.99613 8.42205L5.36743 9.11381C3.87467 9.50664 3.37072 11.3707 4.4622 12.4622L8 16L11.5378 19.5378C12.6293 20.6293 14.4933 20.1253 14.8862 18.6326L15.5779 16.0038M8 16L4 20M12.25 6L13.259 3.98188C13.8695 2.76088 15.4968 2.49681 16.4621 3.46209L20.5379 7.53786C21.5032 8.50314 21.2391 10.1304 20.0181 10.7409L18 11.75M3 2.99998L21 21"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
