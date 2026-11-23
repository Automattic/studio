import type { ComponentProps } from 'react';

export function ArrowLeftIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 256 256"
			fill="currentColor"
			stroke="currentColor"
			strokeWidth="4"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" />
		</svg>
	);
}
