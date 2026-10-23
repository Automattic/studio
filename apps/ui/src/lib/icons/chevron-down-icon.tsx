import type { ComponentProps } from 'react';

export function ChevronDownIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" { ...props }>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M4.37573 6.18284C4.61005 5.94853 4.98995 5.94853 5.22426 6.18284L7.71715 8.67574C7.87336 8.83195 8.12663 8.83195 8.28284 8.67574L10.7757 6.18284C11.01 5.94853 11.3899 5.94853 11.6243 6.18284C11.8586 6.41716 11.8586 6.79706 11.6243 7.03137L9.13137 9.52426C8.50653 10.1491 7.49346 10.1491 6.86863 9.52426L4.37573 7.03137C4.14142 6.79706 4.14142 6.41716 4.37573 6.18284Z"
				fill="currentColor"
			/>
		</svg>
	);
}
