import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedLocale, supportedLocaleNames } from 'common/lib/locale';

interface LanguagePickerProps {
	value: SupportedLocale;
	onChange: ( value: SupportedLocale ) => void;
}

export const LanguagePicker = ( { value, onChange }: LanguagePickerProps ) => {
	const { __ } = useI18n();
	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Language' ) }</h2>
			<SelectControl
				value={ value || 'en' }
				onChange={ onChange }
				options={ Object.entries( supportedLocaleNames ).map( ( [ locale, label ] ) => ( {
					value: locale as SupportedLocale,
					label,
				} ) ) }
				__nextHasNoMarginBottom
				className="mb-2"
			/>
		</div>
	);
};
