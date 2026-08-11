/**
 * Single-select segmented control. `@wordpress/ui` has no equivalent, so this
 * wraps the `@base-ui/react` toggle primitives locally (the same approach as
 * `components/menu/` and `components/spinner/`), which supplies the pressed
 * state and arrow-key focus behavior.
 *
 * The selected-segment fill is a separate element that slides between
 * segments (the same measured-indicator approach as the site preview's
 * location omnibox).
 */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export interface SegmentedControlOption< Value extends string > {
	value: Value;
	label: ReactNode;
	// For icon-only segments: shown as a tooltip and used as the segment's
	// accessible name.
	tooltip?: string;
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
	const rootRef = useRef< HTMLDivElement | null >( null );
	const [ indicator, setIndicator ] = useState< { left: number; width: number } | null >( null );
	const measureIndicator = useCallback( () => {
		const pressed = rootRef.current?.querySelector< HTMLElement >( 'button[data-pressed]' );
		if ( ! pressed ) {
			return;
		}
		const left = pressed.offsetLeft;
		const width = pressed.offsetWidth;
		setIndicator( ( current ) =>
			current && current.left === left && current.width === width ? current : { left, width }
		);
	}, [] );
	useLayoutEffect( measureIndicator, [ measureIndicator, value, options ] );
	useEffect( () => {
		const root = rootRef.current;
		if ( ! root || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( measureIndicator );
		observer.observe( root );
		return () => observer.disconnect();
	}, [ measureIndicator ] );

	return (
		<ToggleGroup
			ref={ rootRef }
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
			{ indicator ? (
				<span
					className={ styles.indicator }
					aria-hidden="true"
					style={ { transform: `translateX(${ indicator.left }px)`, width: indicator.width } }
				/>
			) : null }
			{ options.map( ( option ) => {
				const toggle = (
					<Toggle value={ option.value } className={ styles.segment } aria-label={ option.tooltip }>
						{ option.label }
					</Toggle>
				);
				if ( ! option.tooltip ) {
					return <Fragment key={ option.value }>{ toggle }</Fragment>;
				}
				return (
					<Tooltip.Root key={ option.value }>
						<Tooltip.Trigger render={ toggle } />
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
							{ option.tooltip }
						</Tooltip.Popup>
					</Tooltip.Root>
				);
			} ) }
		</ToggleGroup>
	);
}
