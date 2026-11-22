import { RENAME_ICON } from '@studio/common/lib/rename-icon';
import type { ComponentProps } from 'react';

export function PencilIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width={ RENAME_ICON.size }
			height={ RENAME_ICON.size }
			viewBox={ RENAME_ICON.viewBox }
			fill="currentColor"
			stroke="currentColor"
			strokeWidth="4"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d={ RENAME_ICON.path } />
		</svg>
	);
}
