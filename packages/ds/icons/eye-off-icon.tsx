import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function EyeOffIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon { ...props }>
			<path vectorEffect="non-scaling-stroke" d="M22 2L2 22" />
			<path
				vectorEffect="non-scaling-stroke"
				d="M6.0017 17.9983C4.8851 17.1804 3.9806 16.2125 3.2749 15.2957L3.2748 15.2956C2.42497 14.1915 2 13.6393 2 12C2 10.3607 2.42497 9.80854 3.2748 8.70443L3.2749 8.7043C4.972 6.4996 7.8181 4 12 4C14.4428 4 16.4298 4.8529 17.9983 6.0017"
			/>
			<path
				vectorEffect="non-scaling-stroke"
				d="M19.8211 7.63452C20.1524 7.99102 20.4535 8.35142 20.7251 8.70432L20.7252 8.70445C21.575 9.80856 22 10.3607 22 12C22 13.6394 21.575 14.1915 20.7252 15.2956L20.7251 15.2957C19.028 17.5004 16.1819 20 12 20C10.5848 20 9.32255 19.7137 8.20605 19.2495"
			/>
			<path
				vectorEffect="non-scaling-stroke"
				d="M9.8787 14.1213C9.3358 13.5784 9 12.8284 9 12C9 10.3431 10.3431 9 12 9C12.8284 9 13.5784 9.3358 14.1213 9.8787"
			/>
		</StrokeIcon>
	);
}
