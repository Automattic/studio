import { RENAME_ICON } from '@studio/common/lib/rename-icon';
import type { ComponentProps } from 'react';

export function RenameIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width={ RENAME_ICON.size }
			height={ RENAME_ICON.size }
			viewBox={ RENAME_ICON.viewBox }
			fill="none"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d={ RENAME_ICON.path }
				stroke="currentColor"
				strokeWidth={ RENAME_ICON.strokeWidth }
				strokeLinecap={ RENAME_ICON.strokeLinecap }
				strokeLinejoin={ RENAME_ICON.strokeLinejoin }
			/>
		</svg>
	);
}
