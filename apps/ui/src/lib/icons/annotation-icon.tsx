import type { ComponentProps } from 'react';

export function AnnotationIcon( props: ComponentProps< 'svg' > ) {
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
				d="M11.9998 7.99999L11.9998 11M11.9998 11V14M11.9998 11H8.99976M11.9998 11H14.9998M11.9977 20.5358L14.7377 18.2657C14.9171 18.1171 15.1427 18.0358 15.3757 18.0358L17.002 18.0358C18.6588 18.0358 20.002 16.6926 20.002 15.0358V7C20.002 5.34314 18.6588 4 17.0019 4L7.00195 4.00002C5.3451 4.00002 4.00195 5.34317 4.00195 7.00002V15.0358C4.00195 16.6926 5.3451 18.0358 7.00195 18.0358H8.65157C8.8865 18.0358 9.11393 18.1185 9.29398 18.2694L11.9977 20.5358Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
