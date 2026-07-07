import { locale_data as ar } from '@studio/common/translations/studio-ar.jed.json';
import { locale_data as ckb } from '@studio/common/translations/studio-ckb.jed.json';
import { locale_data as de } from '@studio/common/translations/studio-de.jed.json';
import { locale_data as es } from '@studio/common/translations/studio-es.jed.json';
import { locale_data as fr } from '@studio/common/translations/studio-fr.jed.json';
import { locale_data as he } from '@studio/common/translations/studio-he.jed.json';
import { locale_data as hu } from '@studio/common/translations/studio-hu.jed.json';
import { locale_data as id } from '@studio/common/translations/studio-id.jed.json';
import { locale_data as it } from '@studio/common/translations/studio-it.jed.json';
import { locale_data as ja } from '@studio/common/translations/studio-ja.jed.json';
import { locale_data as ko } from '@studio/common/translations/studio-ko.jed.json';
import { locale_data as nl } from '@studio/common/translations/studio-nl.jed.json';
import { locale_data as pl } from '@studio/common/translations/studio-pl.jed.json';
import { locale_data as ptBR } from '@studio/common/translations/studio-pt-br.jed.json';
import { locale_data as ru } from '@studio/common/translations/studio-ru.jed.json';
import { locale_data as sv } from '@studio/common/translations/studio-sv.jed.json';
import { locale_data as tr } from '@studio/common/translations/studio-tr.jed.json';
import { locale_data as uk } from '@studio/common/translations/studio-uk.jed.json';
import { locale_data as vi } from '@studio/common/translations/studio-vi.jed.json';
import { locale_data as zhCN } from '@studio/common/translations/studio-zh-cn.jed.json';
import { locale_data as zhTW } from '@studio/common/translations/studio-zh-tw.jed.json';

type LocaleData = {
	messages: Record< string, string[] | { domain: string; 'plural-forms': string; lang: string } >;
};
type SupportedLocale =
	| 'ar'
	| 'ckb'
	| 'de'
	| 'en'
	| 'es'
	| 'fr'
	| 'he'
	| 'hu'
	| 'id'
	| 'it'
	| 'ja'
	| 'ko'
	| 'nl'
	| 'pl'
	| 'pt-br'
	| 'ru'
	| 'sv'
	| 'tr'
	| 'uk'
	| 'vi'
	| 'zh-cn'
	| 'zh-tw';

export const localeDataDictionary: Record< SupportedLocale, LocaleData | null > = {
	ar,
	ckb,
	de,
	en: null,
	es,
	fr,
	he,
	hu,
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
