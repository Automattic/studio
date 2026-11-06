import type { ComponentProps } from 'react';

export function FeedbackIcon( props: ComponentProps< 'svg' > ) {
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
				d="M12 7.75L12 11M12 11V14.25M12 11H8.75M12 11H15.25M9.29422 18.4836L11.3593 20.2147C11.7292 20.5248 12.2679 20.5263 12.6397 20.2183L14.738 18.4799C14.9173 18.3313 15.143 18.25 15.3759 18.25H19.25C19.8023 18.25 20.25 17.8023 20.25 17.25V4.75C20.25 4.19772 19.8023 3.75 19.25 3.75H4.75C4.19772 3.75 3.75 4.19771 3.75 4.75V17.25C3.75 17.8023 4.19772 18.25 4.75 18.25H8.65182C8.88675 18.25 9.11418 18.3327 9.29422 18.4836Z"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
