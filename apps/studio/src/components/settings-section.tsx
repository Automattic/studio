import { cx } from 'src/lib/cx';
import type { ReactNode } from 'react';

/**
 * One titled group of settings, separated from the previous group by a rule.
 * The first section omits the rule so a form doesn't open with a stray line.
 */
export function SettingsSection( {
	title,
	isFirst = false,
	children,
}: {
	title: string;
	isFirst?: boolean;
	children: ReactNode;
} ) {
	return (
		<section
			className={ cx( 'flex flex-col', ! isFirst && 'mt-6 border-t border-frame-border pt-6' ) }
		>
			<h2 className="a8c-subtitle-small mb-3">{ title }</h2>
			{ children }
		</section>
	);
}
