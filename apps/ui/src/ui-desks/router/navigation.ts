import { useRouter } from '@tanstack/react-router';

type DesksRoutePath =
	| '/'
	| '/sites/$siteId'
	| '/onboarding'
	| '/onboarding/create'
	| '/onboarding/blueprint'
	| '/onboarding/import';

type DesksSearch = Record< string, unknown >;

interface DesksNavigateOptions {
	to: DesksRoutePath;
	params?: {
		siteId: string;
	};
	search?: DesksSearch | ( ( previous: DesksSearch ) => DesksSearch );
	replace?: boolean;
}

export function useDesksNavigate() {
	const router = useRouter();
	return router.navigate as ( options: DesksNavigateOptions ) => Promise< void >;
}

export function useDesksLocation() {
	return useRouter().state.location;
}
