import { useUserPreferences } from '@/data/queries/use-user-preferences';

/**
 * The user's window-chrome ("frame") color override, or `null` when they haven't
 * chosen one (the scheme-aware default chrome applies).
 *
 * Must be used inside the connector + query providers (it reads
 * {@link useUserPreferences}).
 */
export function useFrameColor(): string | null {
	const { data: preferences } = useUserPreferences();
	return preferences?.frameColor ?? null;
}
