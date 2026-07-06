import { AI_MODELS, type AiModelId } from '@studio/common/ai/models';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SettingsFormField } from './settings-form-field';

interface DefaultModelPickerProps {
	value: AiModelId;
	onChange: ( value: AiModelId ) => void;
}

export const DefaultModelPicker = ( { value, onChange }: DefaultModelPickerProps ) => {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'Default model' ) }>
			<SelectControl< AiModelId >
				value={ value }
				onChange={ onChange }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				{ AI_MODELS.map( ( model ) => (
					<option key={ model.id } value={ model.id }>
						{ model.label }
					</option>
				) ) }
			</SelectControl>
			<p className="a8c-body-small text-frame-text-secondary m-0">
				{ __(
					'The model new conversations start with. You can still switch models per conversation from the chat.'
				) }
			</p>
		</SettingsFormField>
	);
};
