import { useMemo } from 'react';
import { useActiveStudioExtensions } from '../hooks/use-active-studio-extensions';

export function useStudioExtensionSidebarSections() {
	const { extensions, isLoading } = useActiveStudioExtensions();
	return {
		isLoading,
		sections: useMemo(
			() => extensions.flatMap( ( extension ) => extension.sidebarSections ?? [] ),
			[ extensions ]
		),
	};
}

export function StudioExtensionSidebarSections() {
	const { sections } = useStudioExtensionSidebarSections();

	return (
		<>
			{ sections.map( ( section ) => {
				const Section = section.component;
				return <Section key={ section.id } />;
			} ) }
		</>
	);
}
