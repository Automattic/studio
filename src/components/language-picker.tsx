import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useI18nData } from '../hooks/use-i18n-data';
import { SupportedLocale, supportedLocaleNames } from '../lib/locale';

export const LanguagePicker = () => {
	const { __ } = useI18n();
	const { locale, setLocale } = useI18nData();
	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Language' ) }</h2>
			<SelectControl
				value={ locale || 'en' }
				onChange={ ( value ) => setLocale( value as SupportedLocale ) }
				options={ Object.entries( supportedLocaleNames ).map( ( [ locale, label ] ) => ( {
					value: locale as SupportedLocale,
					label,
				} ) ) }
			/>
		</div>
	);
};
