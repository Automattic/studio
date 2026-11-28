import { PLUS_ICON } from './paths';
import type { ComponentProps } from 'react';

export function PlusIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width={ PLUS_ICON.size }
			height={ PLUS_ICON.size }
			viewBox={ PLUS_ICON.viewBox }
			fill="currentColor"
			aria-hidden="true"
			{ ...props }
		>
			<path d={ PLUS_ICON.path } />
		</svg>
	);
}
