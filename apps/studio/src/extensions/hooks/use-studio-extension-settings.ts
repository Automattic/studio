import { useMemo } from 'react';
import { useActiveStudioExtensions } from './use-active-studio-extensions';

export function useStudioExtensionSettingsTabs() {
	const { extensions } = useActiveStudioExtensions();
	return useMemo(
		() => extensions.flatMap( ( extension ) => extension.settingsTabs ?? [] ),
		[ extensions ]
	);
}

export function useStudioExtensionAccountSections() {
	const { extensions } = useActiveStudioExtensions();
	return useMemo(
		() => extensions.flatMap( ( extension ) => extension.accountSections ?? [] ),
		[ extensions ]
	);
}
