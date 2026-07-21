import { SelectControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
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
		return (
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						// Disabled form controls swallow pointer events, so exclude
						// the select from hit-testing to guarantee the trigger
						// receives the hover.
						<div>
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
