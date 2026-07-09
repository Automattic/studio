// To run tests, execute `npm run test -- src/hooks/tests/use-localization-support.test.tsx` from the root directory
/**
 * RTL/visual localization check (STU-1872) — kept in the renderer because text
 * direction is a rendering concern the CLI suite can't cover. Loading an RTL
 * locale must flip `document.documentElement.dir` to `rtl`, and an LTR locale
 * back to `ltr`.
 */
import { getLocaleData } from '@studio/common/lib/locale';
import { render } from '@testing-library/react';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { Provider } from 'react-redux';
import { afterEach } from 'vitest';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { store } from 'src/stores';

function Probe() {
	useLocalizationSupport();
	return null;
}

function renderWithLocale( locale: string ) {
	defaultI18n.setLocaleData( getLocaleData( locale )?.messages );
	return render(
		<Provider store={ store }>
			<I18nProvider i18n={ defaultI18n }>
				<Probe />
			</I18nProvider>
		</Provider>
	);
}

afterEach( () => {
	defaultI18n.resetLocaleData();
	document.documentElement.dir = 'ltr';
} );

describe( 'useLocalizationSupport', () => {
	it( 'sets the document direction to rtl for an RTL locale', () => {
		renderWithLocale( 'ar' );
		expect( document.documentElement.dir ).toBe( 'rtl' );
	} );

	it( 'sets the document direction to ltr for an LTR locale', () => {
		renderWithLocale( 'fr' );
		expect( document.documentElement.dir ).toBe( 'ltr' );
	} );
} );
