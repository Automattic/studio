import type { ComponentProps } from 'react';

export function BellIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M16 17C16 19.2091 14.2091 21 12 21C9.79086 21 8 19.2091 8 17M18.2996 8.99251L18.4686 12.3712C18.4893 12.7859 18.5959 13.1917 18.7815 13.5631L19.9146 15.8292C19.9708 15.9415 20 16.0654 20 16.191C20 16.6378 19.6378 17 19.191 17H4.80902C4.36221 17 4 16.6378 4 16.191C4 16.0654 4.02924 15.9415 4.08541 15.8292L5.21846 13.5631C5.40413 13.1917 5.51071 12.7859 5.53144 12.3712L5.70037 8.99251C5.86822 5.63561 8.6389 3 12 3C15.3611 3 18.1318 5.63561 18.2996 8.99251Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
