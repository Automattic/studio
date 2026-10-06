import { BaseControl } from '@wordpress/components';
import { useId } from 'react';
import styles from './style.module.css';
import type { DataFormControlProps, Option } from '@wordpress/dataviews';

export type RuntimeChoiceOption = Option & {
	/** Explanation rendered under the choice, like the WordPress update radios. */
	optionDescription?: string;
};

/**
 * Radio group for the file access setting. It is a two-way choice whose
 * explanation changes with the selection, which a dropdown can only show after
 * the fact — the radios put both explanations on screen at once (STU-2401).
 */
export function RuntimeChoiceControl< Item >( {
	data,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< Item > ) {
	// Unique per instance so each group keeps its own radio group and
	// label/description associations.
	const groupName = useId();
	const value = field.getValue( { item: data } ) ?? '';
	const disabled = field.isDisabled( { item: data, field } );
	const options = ( field.elements ?? [] ) as RuntimeChoiceOption[];

	return (
		<BaseControl
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			help={ field.description }
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
}
