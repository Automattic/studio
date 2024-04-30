import { SelectControl } from '@wordpress/components';
import { useState } from 'react';

// TODO - Move to locales.ts
export const namedLocales = [
	{ name: 'Arabic', locale: 'ar' },
	{ name: 'German', locale: 'de' },
	{ name: 'English', locale: 'en' },
	{ name: 'Spanish', locale: 'es' },
	{ name: 'French', locale: 'fr' },
	{ name: 'Hebrew', locale: 'he' },
	{ name: 'Indonesian', locale: 'id' },
	{ name: 'Italian', locale: 'it' },
	{ name: 'Japanese', locale: 'ja' },
	{ name: 'Korean', locale: 'ko' },
	{ name: 'Dutch', locale: 'nl' },
	{ name: 'Polish', locale: 'pl' },
	{ name: 'Portuguese (Brazil)', locale: 'pt-br' },
	{ name: 'Russian', locale: 'ru' },
	{ name: 'Swedish', locale: 'sv' },
	{ name: 'Turkish', locale: 'tr' },
	{ name: 'Chinese (Simplified)', locale: 'zh-cn' },
	{ name: 'Chinese (Traditional)', locale: 'zh-tw' },
];

export const LanguagePicker = () => {
	const [ locale, setLocale ] = useState( '' );

	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">Language</h2>
			<SelectControl
				value={ locale || 'en' }
				onChange={ ( value ) => {
					setLocale( value );
				} }
				options={ namedLocales.map( ( { name, locale } ) => ( {
					value: locale,
					label: name,
				} ) ) }
			/>
		</div>
	);
};
