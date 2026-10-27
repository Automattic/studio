import type { ComponentProps } from 'react';

export function SendIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M12 3C12.2652 3 12.5196 3.10536 12.7071 3.29289L18.7071 9.29289C19.0976 9.68342 19.0976 10.3166 18.7071 10.7071C18.3166 11.0976 17.6834 11.0976 17.2929 10.7071L13 6.41421V20C13 20.5523 12.5523 21 12 21C11.4477 21 11 20.5523 11 20V6.41422L6.70711 10.7071C6.31658 11.0976 5.68342 11.0976 5.29289 10.7071C4.90237 10.3166 4.90237 9.68342 5.29289 9.29289L11.2929 3.29289C11.4804 3.10536 11.7348 3 12 3Z"
				fillRule="evenodd"
				clipRule="evenodd"
				fill="currentColor"
			/>
		</svg>
	);
}
