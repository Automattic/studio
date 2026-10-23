import type { ComponentProps } from 'react';

export function StopSiteIcon( props: ComponentProps< 'svg' > ) {
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
				d="M19.25 14.45V9.55C19.25 7.86984 19.25 7.02976 18.923 6.38803C18.6354 5.82354 18.1765 5.3646 17.612 5.07698C16.9702 4.75 16.1302 4.75 14.45 4.75L9.55 4.75C7.86984 4.75 7.02976 4.75 6.38803 5.07698C5.82354 5.3646 5.3646 5.82354 5.07698 6.38803C4.75 7.02976 4.75 7.86984 4.75 9.55V14.45C4.75 16.1302 4.75 16.9702 5.07698 17.612C5.3646 18.1765 5.82354 18.6354 6.38803 18.923C7.02976 19.25 7.86984 19.25 9.55 19.25H14.45C16.1302 19.25 16.9702 19.25 17.612 18.923C18.1765 18.6354 18.6354 18.1765 18.923 17.612C19.25 16.9702 19.25 16.1302 19.25 14.45Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
