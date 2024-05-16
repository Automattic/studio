import { SelectControl } from '@wordpress/components';
import { useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

// TODO: use supportedLocales from locale.ts
export const supportedLocales = {
	ar: 'العربية',
	de: 'Deutsch',
	en: 'English',
	es: 'Español',
	fr: 'Français',
	he: 'עברית',
	id: 'Bahasa Indonesia',
	it: 'Italiano',
	ja: '日本語',
	ko: '한국어',
	nl: 'Nederlands',
	pl: 'Polski',
	'pt-br': 'Português (Brasil)',
	ru: 'Русский',
	sv: 'Svenska',
	tr: 'Türkçe',
	'zh-cn': '简体中文',
	'zh-tw': '繁體中文',
};

export const LanguagePicker = () => {
	const [ locale, setLocale ] = useState( '' );

	const handleLocaleChange = ( value: string ) => {
		console.log( `Switching to locale: ${ value }` );
		setLocale( value );

		// Save locale string to saveUserLocale
		getIpcApi().saveUserLocale( value );
	};

	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">Language</h2>
			<SelectControl
				value={ locale || 'en' }
				onChange={ handleLocaleChange }
				options={ Object.entries( supportedLocales ).map( ( [ locale, name ] ) => ( {
					value: locale,
					label: name as string,
				} ) ) }
			/>
		</div>
	);
};
