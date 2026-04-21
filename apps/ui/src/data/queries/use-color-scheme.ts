import { useUserPreferences, useSaveUserPreferences } from './use-user-preferences';
import type { ColorScheme } from '@/data/core';

export function useColorScheme() {
	const { data, ...rest } = useUserPreferences();
	return { ...rest, data: data?.colorScheme };
}

export function useSaveColorScheme() {
	const save = useSaveUserPreferences();
	return {
		...save,
		mutate: ( scheme: ColorScheme ) => save.mutate( { colorScheme: scheme } ),
	};
}
