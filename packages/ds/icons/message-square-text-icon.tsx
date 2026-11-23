import type { ComponentProps } from 'react';

export function MessageSquareTextIcon( props: ComponentProps< 'svg' > ) {
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
			<path d="M169.57,72.59A80,80,0,0,0,16,104v64a16,16,0,0,0,16,16H86.67A80.15,80.15,0,0,0,160,232h64a16,16,0,0,0,16-16V152A80,80,0,0,0,169.57,72.59ZM32,104a64,64,0,1,1,64,64H32ZM224,216H160a64.14,64.14,0,0,1-55.68-32.43A79.93,79.93,0,0,0,174.7,89.71,64,64,0,0,1,224,152Z" />
		</svg>
	);
}
