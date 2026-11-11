import { PLUS_ICON } from '@studio/common/lib/plus-icon';
import type { ComponentProps } from 'react';

export function PlusIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width={ PLUS_ICON.size }
			height={ PLUS_ICON.size }
			viewBox={ PLUS_ICON.viewBox }
			fill="none"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d={ PLUS_ICON.path }
				strokeWidth={ PLUS_ICON.strokeWidth }
				strokeLinecap={ PLUS_ICON.strokeLinecap }
				stroke="currentColor"
			/>
		</svg>
	);
}
