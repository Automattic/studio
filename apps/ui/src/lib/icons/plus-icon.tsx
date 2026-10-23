import type { ComponentProps } from 'react';

export function PlusIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.66785 2C8.03605 2 8.33452 2.29848 8.33452 2.66667V7.33333H13.0012C13.3694 7.33333 13.6679 7.6318 13.6679 8C13.6679 8.3682 13.3694 8.66667 13.0012 8.66667H8.33452V13.3333C8.33452 13.7015 8.03605 14 7.66785 14C7.29965 14 7.00119 13.7015 7.00119 13.3333V8.66667H2.33452C1.96633 8.66667 1.66785 8.3682 1.66785 8C1.66785 7.6318 1.96633 7.33333 2.33452 7.33333H7.00119V2.66667C7.00119 2.29848 7.29965 2 7.66785 2Z"
				fill="currentColor"
			/>
		</svg>
	);
}
