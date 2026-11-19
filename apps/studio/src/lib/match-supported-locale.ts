import { match } from '@formatjs/intl-localematcher';
import { DEFAULT_LOCALE, SupportedLocale, supportedLocales } from '@studio/common/lib/locale';

/**
 * The Studio translation that best fits a BCP 47 locale, or English when none does.
 */
export function matchSupportedLocale( locale: string ): SupportedLocale {
	// `match` canonicalizes BCP-47 casing (e.g. `zh-cn` -> `zh-CN`), but our
	// supported-locale keys are lowercase
	return match( [ locale ], supportedLocales, DEFAULT_LOCALE ).toLowerCase() as SupportedLocale;
}
