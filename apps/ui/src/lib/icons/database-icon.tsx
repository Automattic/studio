import type { ComponentProps } from 'react';

export function DatabaseIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M19.25 12C19.25 13.3807 16.0041 14.5 12 14.5C7.99594 14.5 4.75 13.3807 4.75 12M4.75 6V18.6806C4.75 20.0996 7.99594 21.25 12 21.25C16.0041 21.25 19.25 20.0996 19.25 18.6806V6M19.25 5.31944C19.25 6.73851 16.0041 7.88889 12 7.88889C7.99594 7.88889 4.75 6.73851 4.75 5.31944C4.75 3.90038 7.99594 2.75 12 2.75C16.0041 2.75 19.25 3.90038 19.25 5.31944Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="square"
			/>
		</svg>
	);
}
