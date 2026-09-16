import {
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	isFileAccessAllowedForRuntime,
} from '@studio/common/lib/site-file-access';
import { getFileAccessRequiresNativeLabel } from '@studio/common/lib/site-runtime-labels';
import { BaseControl } from '@wordpress/components';
import { Tooltip } from '@wordpress/ui';
import { useId } from 'react';
import styles from './style.module.css';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';
import type { DataFormControlProps, Option } from '@wordpress/dataviews';

export type RuntimeChoiceOption = Option & {
	/** Explanation rendered under the choice, like the WordPress update radios. */
	optionDescription?: string;
};

/**
 * Radio group for the PHP runtime and file access settings. Both are two-way
 * choices whose explanation changes with the selection, which a dropdown can
 * only show after the fact — the radios put both explanations on screen at once
 * (STU-2401).
 *
 * File access is only meaningful under the native runtime, so the sandbox
 * disables the group and explains why on hover or keyboard focus.
 */
export function RuntimeChoiceControl< Item >( {
	data,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< Item > ) {
	// Unique per instance so the runtime and file-access groups on one screen
	// keep their own radio group and label/description associations.
	const groupName = useId();
	const value = field.getValue( { item: data } ) ?? '';
	const disabled = field.isDisabled( { item: data, field } );
	const options = ( field.elements ?? [] ) as RuntimeChoiceOption[];

	const control = (
		<BaseControl
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
		>
			<fieldset className={ styles.choiceControl } disabled={ disabled } aria-label={ field.label }>
				<div className="components-radio-control">
					{ options.map( ( option ) => {
						const optionId = `${ groupName }-${ option.value }`;
						return (
							<div key={ option.value } className="components-radio-control__option">
								<input
									id={ optionId }
									className="components-radio-control__input"
									type="radio"
									name={ groupName }
									value={ option.value }
									checked={ value === option.value }
									// Forms mode announces only the radio's label and
									// description, so the description has to be named here.
									aria-describedby={
										option.optionDescription ? `${ optionId }-description` : undefined
									}
									onChange={ () =>
										onChange( field.setValue( { item: data, value: option.value } ) )
									}
								/>
								<label htmlFor={ optionId } className="components-radio-control__label">
									{ option.label }
								</label>
								{ option.optionDescription && (
									<p
										id={ `${ optionId }-description` }
										className="components-radio-control__option-description"
									>
										{ option.optionDescription }
									</p>
								) }
							</div>
						);
					} ) }
				</div>
			</fieldset>
		</BaseControl>
	);

	if ( ! disabled ) {
		return control;
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					// Disabled form controls swallow pointer events, so exclude the
					// radios from hit-testing to guarantee the wrapper gets the hover.
					<div>
						<div style={ { pointerEvents: 'none' } }>{ control }</div>
					</div>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" align="start" /> }>
				{ getFileAccessRequiresNativeLabel() }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}

/**
 * The file access a site effectively runs with. The sandbox can only ever reach
 * the site directory, so a stored `all-files` from a previous native run is
 * coerced rather than shown — the same rule the Classic forms apply.
 */
export function effectiveFileAccess<
	T extends { runtime: SiteRuntime; fileAccess: SiteFileAccess },
>( item: T ): SiteFileAccess {
	return isFileAccessAllowedForRuntime( item.runtime, item.fileAccess )
		? item.fileAccess
		: SITE_FILE_ACCESS_SITE_DIRECTORY;
}
