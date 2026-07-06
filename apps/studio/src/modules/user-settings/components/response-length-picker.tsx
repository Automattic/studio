import { type AiResponseLength } from '@studio/common/ai/response-length';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import { SettingsFormField } from './settings-form-field';

interface ResponseLengthPickerProps {
	value: AiResponseLength;
	onChange: ( value: AiResponseLength ) => void;
}

export const ResponseLengthPicker = ( { value, onChange }: ResponseLengthPickerProps ) => {
	const { __ } = useI18n();
	const options: Array< { value: AiResponseLength; label: string } > = [
		{ value: 'compact', label: __( 'Compact' ) },
		{ value: 'normal', label: __( 'Normal' ) },
		{ value: 'verbose', label: __( 'Verbose' ) },
	];

	return (
		<SettingsFormField label={ __( 'Agent response length' ) }>
			<div
				role="radiogroup"
				aria-label={ __( 'Agent response length' ) }
				className="grid grid-cols-3 rounded-sm border border-frame-border overflow-hidden w-fit"
			>
				{ options.map( ( option, index ) => {
					const isSelected = value === option.value;

					return (
						<button
							key={ option.value }
							type="button"
							role="radio"
							aria-checked={ isSelected }
							onClick={ () => onChange( option.value ) }
							className={ cx(
								'px-4 py-1.5 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:bg-frame-surface',
								index > 0 && 'border-l border-frame-border',
								isSelected
									? 'bg-frame-text text-frame font-medium'
									: 'bg-transparent text-frame-text'
							) }
						>
							{ option.label }
						</button>
					);
				} ) }
			</div>
			<p className="a8c-body-small text-frame-text-secondary m-0">
				{ __(
					'How long the agent’s replies should be. Compact leads with the answer; Verbose explains the reasoning.'
				) }
			</p>
		</SettingsFormField>
	);
};
