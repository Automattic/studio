import type { ComponentProps } from 'react';

export function RenameIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M18 10.5L7.79289 20.7071C7.60536 20.8946 7.351 21 7.08579 21H3V16.9142C3 16.649 3.10536 16.3946 3.29289 16.2071L13.5 5.99997L15.25 4.24997C16.4926 3.00733 18.5074 3.00733 19.75 4.24997C20.9926 5.49261 20.9926 7.50733 19.75 8.74997L18 10.5ZM13.5 5.99997L18 10.5"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
