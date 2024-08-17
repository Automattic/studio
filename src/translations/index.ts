import { LocaleData } from '@wordpress/i18n';
import { SupportedLocale } from '../lib/supported-locales';
import ar from './studio-ar.jed.json';
import de from './studio-de.jed.json';
import es from './studio-es.jed.json';
import fr from './studio-fr.jed.json';
import he from './studio-he.jed.json';
import id from './studio-id.jed.json';
import it from './studio-it.jed.json';
import ja from './studio-ja.jed.json';
import ko from './studio-ko.jed.json';
import nl from './studio-nl.jed.json';
import pl from './studio-pl.jed.json';
import ptBR from './studio-pt-br.jed.json';
import ru from './studio-ru.jed.json';
import sv from './studio-sv.jed.json';
import tr from './studio-tr.jed.json';
import uk from './studio-uk.jed.json';
import vi from './studio-vi.jed.json';
import zhCN from './studio-zh-cn.jed.json';
import zhTW from './studio-zh-tw.jed.json';

export const localeDataDictionary: Record<SupportedLocale, LocaleData> = {
  ar,
  de,
  en:{},
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