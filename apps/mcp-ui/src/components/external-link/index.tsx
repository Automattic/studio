import { openLink } from '@/data/bridge';
import type { AnchorHTMLAttributes } from 'react';

// Hosts open links themselves; a sandboxed frame cannot navigate away.
export function ExternalLink( {
	href,
	...props
}: AnchorHTMLAttributes< HTMLAnchorElement > & { href: string } ) {
	return (
		<a
			{ ...props }
			href={ href }
			target="_blank"
			rel="noopener noreferrer"
			onClick={ ( event ) => {
				event.preventDefault();
				void openLink( href );
			} }
		/>
	);
}
