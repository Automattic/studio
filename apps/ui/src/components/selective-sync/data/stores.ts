import { useUserLocale } from '@/data/queries/use-user-locale';
import type { SupportedLocale } from '@studio/common/lib/locale';

// Adapter replacing the legacy renderer's `useI18nLocale` (src/stores) for the
// copied selective-sync modules.
export function useI18nLocale(): SupportedLocale {
	return useUserLocale() ?? 'en';
}
