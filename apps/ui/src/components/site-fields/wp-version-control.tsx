import { BaseControl, SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import styles from './style.module.css';
import type { DataFormControlProps, Option } from '@wordpress/dataviews';

// Ported from the legacy UI (apps/studio/src/components/offline-icon.tsx).
const offlineIcon = (
	<svg viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M14.3616 11.2468C15.339 10.682 15.9996 9.60352 15.9996 8.36597C15.9996 6.73087 14.8465 5.37347 13.3331 5.11157L13.3333 5.06597C13.3333 2.63597 11.1843 0.666016 8.5333 0.666016C7.2983 0.666016 6.17225 1.09355 5.32167 1.79598L6.36271 2.88434C6.9296 2.44576 7.67855 2.16602 8.5333 2.16602C10.4814 2.16602 11.8333 3.58458 11.8333 5.06597L11.8332 5.09497L11.8191 6.37187L13.0773 6.58967C13.8512 6.72357 14.4996 7.43967 14.4996 8.36597C14.4996 9.22043 13.9545 9.88797 13.262 10.0972L14.3616 11.2468Z" />
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M3.75555 11.6659H10.6867L12.458 13.5177C12.7443 13.817 13.2191 13.8276 13.5184 13.5413C13.8177 13.2549 13.8283 12.7802 13.542 12.4809L2.54198 0.980852C2.25567 0.681524 1.78091 0.670974 1.48158 0.957287C1.18226 1.2436 1.17171 1.71836 1.45802 2.01769L3.34162 3.9869C1.46387 4.18881 0 5.82609 0 7.81597C0 9.94227 1.67147 11.666 3.73333 11.666L3.75555 11.6659ZM4.79619 5.50759L3.82248 5.46777C3.793 5.46657 3.76328 5.46597 3.73333 5.46597C2.54307 5.46597 1.5 6.47427 1.5 7.81597C1.5 9.15625 2.54088 10.1638 3.72957 10.166L3.75105 10.1659H9.25193L4.79619 5.50759Z"
		/>
	</svg>
);

export type WpVersionOption = Option & {
	group: 'latest' | 'prerelease' | 'stable';
	hidden?: boolean;
	current?: boolean;
};

/**
 * WordPress version dropdown: the auto-update option first, then the pinned
 * versions in optgroups. When the field is disabled with a description
 * (offline), the description shows as a hover tooltip like the legacy UI
 * instead of inline help text.
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
	const autoUpdateOption = options.find(
		( option ) => option.group === 'latest' && ! option.hidden
	);
	const pinnedOptions = options.filter(
		( option ) => option.group !== 'latest' && ! option.hidden
	);
	const currentVersion = pinnedOptions.find( ( option ) => option.current );
	// Without a version list there is nothing to pin to, so the settings form
	// keeps the plain dropdown rather than offering an empty picker.
	const usesUpdateModeControl = autoUpdateOption?.value === '' && pinnedOptions.length > 0;
	const automaticUpdates = value === autoUpdateOption?.value;
	const modeControlName = `${ String( field.id ) }-update-mode`;
	// Outside the update-mode control the auto-update option carries its own
	// explanation, so it needs no heading; HTML allows plain options before the
	// first optgroup.
	const autoUpdateOptions = usesUpdateModeControl
		? []
		: options.filter( ( option ) => option.group === 'latest' );
	const groups = [
		{
			label: __( 'Beta & Nightly' ),
			options: options.filter( ( option ) => option.group === 'prerelease' ),
		},
		{
			label: __( 'Stable Versions' ),
			options: options.filter( ( option ) => option.group === 'stable' ),
		},
	].filter( ( group ) => group.options.length > 0 );

	const updateValue = ( newValue: string ) =>
		onChange( field.setValue( { item: data, value: newValue } ) );
	const selectedVersion =
		usesUpdateModeControl && automaticUpdates
			? currentVersion?.value ?? pinnedOptions[ 0 ]?.value ?? value
			: value;
	const versionSelect = (
		<SelectControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			label={ usesUpdateModeControl ? __( 'Version' ) : field.label }
			hideLabelFromVision={ usesUpdateModeControl ? true : hideLabelFromVision }
			value={ selectedVersion }
			disabled={ disabled }
			onChange={ updateValue }
		>
			{ autoUpdateOptions.map( ( option ) => (
				<option key={ option.value } value={ option.value } hidden={ option.hidden }>
					{ option.label }
				</option>
			) ) }
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
	const control = usesUpdateModeControl ? (
		<BaseControl
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
		>
			<fieldset
				className={ styles.updateModeControl }
				disabled={ disabled }
				aria-label={ field.label }
			>
				<div className="components-radio-control">
					<div className="components-radio-control__option">
						<input
							id={ `${ modeControlName }-automatic` }
							className="components-radio-control__input"
							type="radio"
							name={ modeControlName }
							value="automatic"
							checked={ automaticUpdates }
							onChange={ () => {
								if ( autoUpdateOption ) updateValue( autoUpdateOption.value );
							} }
						/>
						<label
							htmlFor={ `${ modeControlName }-automatic` }
							className="components-radio-control__label"
						>
							{ __( 'Automatic updates' ) }
						</label>
						<p className="components-radio-control__option-description">
							{ /* Naming a version on a pinned site would read as if
							     auto-update were keeping it there. */ }
							{ automaticUpdates && currentVersion
								? sprintf(
										/* translators: %s: WordPress version the site runs now, e.g. 6.9.7 */
										__(
											'WordPress installs updates on its own schedule. Currently using version %s.'
										),
										currentVersion.value
								  )
								: __( 'WordPress installs updates on its own schedule.' ) }
						</p>
					</div>
					<div className="components-radio-control__option">
						<input
							id={ `${ modeControlName }-pinned` }
							className="components-radio-control__input"
							type="radio"
							name={ modeControlName }
							value="pinned"
							checked={ ! automaticUpdates }
							onChange={ () =>
								updateValue( currentVersion?.value ?? pinnedOptions[ 0 ]?.value ?? value )
							}
						/>
						<label
							htmlFor={ `${ modeControlName }-pinned` }
							className="components-radio-control__label"
						>
							{ __( 'Select a version' ) }
						</label>
						<div
							className={ `${ styles.pinnedVersionSelect } components-radio-control__option-description` }
						>
							{ versionSelect }
						</div>
					</div>
				</div>
			</fieldset>
		</BaseControl>
	) : (
		versionSelect
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
							<div style={ { pointerEvents: 'none' } }>{ control }</div>
						</div>
					}
				/>
				<Tooltip.Popup
					className={ styles.offlineTooltip }
					positioner={ <Tooltip.Positioner side="top" align="start" /> }
				>
					<Icon icon={ offlineIcon } size={ 16 } />
					{ field.description }
				</Tooltip.Popup>
			</Tooltip.Root>
		);
	}
	return control;
}
