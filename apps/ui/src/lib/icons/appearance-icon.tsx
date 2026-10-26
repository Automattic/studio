import type { ComponentProps } from 'react';

export function AppearanceIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M7.4 12.25H7.6M10.4 8H10.6M15.4 9.5H15.6M8 12.25C8 12.5261 7.77614 12.75 7.5 12.75C7.22386 12.75 7 12.5261 7 12.25C7 11.9739 7.22386 11.75 7.5 11.75C7.77614 11.75 8 11.9739 8 12.25ZM11 8C11 8.27614 10.7761 8.5 10.5 8.5C10.2239 8.5 10 8.27614 10 8C10 7.72386 10.2239 7.5 10.5 7.5C10.7761 7.5 11 7.72386 11 8ZM16 9.5C16 9.77614 15.7761 10 15.5 10C15.2239 10 15 9.77614 15 9.5C15 9.22386 15.2239 9 15.5 9C15.7761 9 16 9.22386 16 9.5ZM12 20.5C7.02944 20.5 3 16.6944 3 12C3 7.30558 7.02944 3.5 12 3.5C16.9706 3.5 21 7.30558 21 12C21 18.9062 13.6125 12.7751 12 16C11 18 14.8273 20.5 12 20.5Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
