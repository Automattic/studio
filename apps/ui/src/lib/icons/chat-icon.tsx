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
				d="M21 12C21 16.9706 16.9706 21 12 21C10.6895 21 9.44452 20.7199 8.32149 20.2164C8.11161 20.1223 7.8775 20.0921 7.65314 20.1428L4.32437 20.8945C3.60019 21.058 2.95662 20.4032 3.1326 19.682L3.91125 16.4909C3.96848 16.2564 3.93688 16.01 3.83508 15.7911C3.29919 14.639 3 13.3544 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
