/**
 * Single-select segmented control. `@wordpress/ui` has no equivalent, so this
 * wraps the `@base-ui/react` toggle primitives locally (the same approach as
 * `components/menu/` and `components/spinner/`), which supplies the pressed
 * state and arrow-key focus behavior.
 */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export interface SegmentedControlOption< Value extends string > {
	value: Value;
	label: ReactNode;
}

export function SegmentedControl< Value extends string >( {
	value,
	options,
	onChange,
	className,
	'aria-label': ariaLabel,
}: {
	value: Value;
	options: SegmentedControlOption< Value >[];
	onChange: ( value: Value ) => void;
	className?: string;
	'aria-label'?: string;
} ) {
	return (
		<ToggleGroup
			value={ [ value ] }
			onValueChange={ ( groupValue: Value[] ) => {
				// Re-pressing the active segment reports an empty group; a
				// segmented control always keeps one segment selected.
				const next = groupValue[ 0 ];
				if ( next && next !== value ) {
					onChange( next );
				}
			} }
			aria-label={ ariaLabel }
			className={ clsx( styles.root, className ) }
		>
			{ options.map( ( option ) => (
				<Toggle key={ option.value } value={ option.value } className={ styles.segment }>
					{ option.label }
				</Toggle>
			) ) }
		</ToggleGroup>
	);
}
