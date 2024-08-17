import { LocaleData } from '@wordpress/i18n';
import { SupportedLocale } from '../lib/supported-locales';
import {locale_data as ar} from './studio-ar.jed.json';
import {locale_data as de} from './studio-de.jed.json';
import {locale_data as es} from './studio-es.jed.json';
import {locale_data as fr} from './studio-fr.jed.json';
import {locale_data as he} from './studio-he.jed.json';
import {locale_data as id} from './studio-id.jed.json';
import {locale_data as it} from './studio-it.jed.json';
import {locale_data as ja} from './studio-ja.jed.json';
import {locale_data as ko} from './studio-ko.jed.json';
import {locale_data as nl} from './studio-nl.jed.json';
import {locale_data as pl} from './studio-pl.jed.json';
import {locale_data as ptBR} from './studio-pt-br.jed.json';
import {locale_data as ru} from './studio-ru.jed.json';
import {locale_data as sv} from './studio-sv.jed.json';
import {locale_data as tr} from './studio-tr.jed.json';
import {locale_data as uk} from './studio-uk.jed.json';
import {locale_data as vi} from './studio-vi.jed.json';
import {locale_data as zhCN} from './studio-zh-cn.jed.json';
import {locale_data as zhTW} from './studio-zh-tw.jed.json';

const localeDataDictionary: Record<SupportedLocale, LocaleData | null > = {
  ar,
  de,
  en: null,
  es,
  fr,
  he,
  id,
  it,
  ja,
  ko,
  nl,
  pl,
  'pt-br': ptBR,
  ru,
  sv,
  tr,
  uk,
  vi,
  'zh-cn': zhCN,
  'zh-tw': zhTW,
};

export function getLocaleData( locale: string ) {
	if ( locale in localeDataDictionary ) {
		return localeDataDictionary[ locale as SupportedLocale ];
	}
	return null;
}