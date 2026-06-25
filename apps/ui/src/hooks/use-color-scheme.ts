import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';

/**
 * The active color scheme that should drive theming.
 *
 * Resolves the user's saved preference ('system' | 'light' | 'dark'), falling
 * back to the OS setting when it's 'system'. The in-app light/dark/system toggle
 * is therefore authoritative — unlike reading `prefers-color-scheme` alone,
 * which only works in the desktop app because Electron's `nativeTheme` mirrors
 * the preference into the media query (a side-channel the browser lacks).
 *
 * Must be used inside the connector + query providers (it reads
 * {@link useUserPreferences}).
 */
export function useColorScheme(): 'light' | 'dark' {
	const osScheme = usePrefersColorScheme();
	const { data: preferences } = useUserPreferences();
	const saved = preferences?.colorScheme ?? 'system';
	if ( saved === 'dark' ) {
		return 'dark';
	}
	if ( saved === 'light' ) {
		return 'light';
	}
	return osScheme;
}
