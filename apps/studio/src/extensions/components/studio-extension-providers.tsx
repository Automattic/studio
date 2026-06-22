import { useMemo, type ReactNode } from 'react';
import { useActiveStudioExtensions } from '../hooks/use-active-studio-extensions';

export function StudioExtensionProviders( { children }: { children: ReactNode } ) {
	const { extensions } = useActiveStudioExtensions();
	const providers = useMemo(
		() => extensions.flatMap( ( extension ) => extension.providers ?? [] ),
		[ extensions ]
	);

	return providers.reduceRight(
		( wrappedChildren, Provider ) => <Provider>{ wrappedChildren }</Provider>,
		children
	);
}
