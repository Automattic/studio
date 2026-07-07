import { isSupportedLocale } from '@studio/common/lib/locale';
import { useUserPreferences } from './use-user-preferences';
import type { SupportedLocale } from '@studio/common/lib/locale';

/**
 * Resolves the current UI locale so components can render locale-aware links
 * (docs, blog, etc). Returns `undefined` until the connector has responded,
 * and `undefined` for any locale that isn't in our translation catalog.
 */
export function useUserLocale(): SupportedLocale | undefined {
	const { data } = useUserPreferences();
	const locale = data?.locale;
	if ( ! locale || ! isSupportedLocale( locale ) ) return undefined;
	return locale;
}
