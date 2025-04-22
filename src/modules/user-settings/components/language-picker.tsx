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
		<div className="flex gap-1.5 flex-col">
			<label className="font-semibold">{ __( 'Language' ) }</label>
			<SelectControl
				value={ value || 'en' }
				onChange={ onChange }
				options={ Object.entries( supportedLocaleNames ).map( ( [ locale, label ] ) => ( {
					value: locale as SupportedLocale,
					label,
				} ) ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			/>
		</div>
	);
};
