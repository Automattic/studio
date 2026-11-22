import type { ComponentProps } from 'react';

export function FolderOpenIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M21 11V8C21 6.89543 20.1046 6 19 6H12.8284C12.298 6 11.7893 5.78929 11.4142 5.41421L10.5858 4.58579C10.2107 4.21071 9.70201 4 9.17157 4H5C3.89543 4 3 4.89543 3 6V17C3 18.1046 3.89543 19 5 19"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
			<path
				data-folder-front
				d="M5 19C5.43738 19 5.82402 18.7157 5.95448 18.2983L8.0159 11.7017C8.14636 11.2843 8.533 11 8.97038 11L21.3199 11C21.6572 11 21.8978 11.3272 21.7971 11.6491L19.5 19C19.5 19 19.5 19 19.5 19L5 19"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
