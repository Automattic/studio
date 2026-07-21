import { SelectControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import type { DataFormControlProps, Option } from '@wordpress/dataviews';

export type WpVersionOption = Option & {
	group: 'latest' | 'prerelease' | 'stable';
	hidden?: boolean;
};

/**
 * WordPress version dropdown with the legacy selector's optgroups
 * (Auto-updating / Beta & Nightly / Stable Versions). When the field is
 * disabled with a description (offline), the description shows as a hover
 * tooltip like the legacy UI instead of inline help text.
 */
export function WpVersionControl< Item >( {
	data,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< Item > ) {
	// The tooltip is controlled by our own hover handlers (like the legacy
	// selector) because Base UI's hover detection doesn't fire over a
	// disabled form control.
	const [ showTooltip, setShowTooltip ] = useState( false );
	const value = field.getValue( { item: data } ) ?? '';
	const disabled = field.isDisabled( { item: data, field } );
	const options = ( field.elements ?? [] ) as WpVersionOption[];
	const groups = [
		{
			label: __( 'Auto-updating' ),
			options: options.filter( ( option ) => option.group === 'latest' ),
		},
		{
			label: __( 'Beta & Nightly' ),
			options: options.filter( ( option ) => option.group === 'prerelease' ),
		},
		{
			label: __( 'Stable Versions' ),
			options: options.filter( ( option ) => option.group === 'stable' ),
		},
	].filter( ( group ) => group.options.length > 0 );

	const select = (
		<SelectControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ value }
			disabled={ disabled }
			onChange={ ( newValue ) => onChange( field.setValue( { item: data, value: newValue } ) ) }
		>
			{ groups.map( ( group ) => (
				<optgroup key={ group.label } label={ group.label }>
					{ group.options.map( ( option ) => (
						<option key={ option.value } value={ option.value } hidden={ option.hidden }>
							{ option.label }
						</option>
					) ) }
				</optgroup>
			) ) }
		</SelectControl>
	);

	if ( disabled && field.description ) {
		// wpds narrows Tooltip.Root's props to hover-only usage; the runtime
		// forwards everything to Base UI, which supports controlled `open`.
		const controlledOpen = { open: showTooltip } as unknown as Parameters<
			typeof Tooltip.Root
		>[ 0 ];
		return (
			<Tooltip.Root { ...controlledOpen }>
				<Tooltip.Trigger
					render={
						// Disabled form controls swallow pointer events, so exclude
						// the select from hit-testing to guarantee the wrapper
						// receives the hover.
						<div
							onMouseEnter={ () => setShowTooltip( true ) }
							onMouseLeave={ () => setShowTooltip( false ) }
						>
							<div style={ { pointerEvents: 'none' } }>{ select }</div>
						</div>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ field.description }
				</Tooltip.Popup>
			</Tooltip.Root>
		);
	}
	return select;
}
