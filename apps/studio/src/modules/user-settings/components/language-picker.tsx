import { SupportedLocale, supportedLocaleNames } from '@studio/common/lib/locale';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SettingsFormField } from './settings-form-field';

interface LanguagePickerProps {
	value: SupportedLocale;
	onChange: ( value: SupportedLocale ) => void;
}

export const LanguagePicker = ( { value, onChange }: LanguagePickerProps ) => {
	const { __ } = useI18n();
	return (
		<SettingsFormField label={ __( 'Language' ) }>
			<SelectControl
				value={ value || 'en' }
				onChange={ onChange }
				options={ Object.entries( supportedLocaleNames ).map( ( [ locale, label ] ) => ( {
					value: locale as SupportedLocale,
					label,
				} ) ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				data-testid="language-select"
			/>
		</SettingsFormField>
	);
};
