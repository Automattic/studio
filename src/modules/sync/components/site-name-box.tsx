import { EnvironmentBadge, StudioBadge } from 'src/components/environment-badge';
import type { EnvironmentType } from 'src/components/environment-badge';

type SiteNameBoxProps = {
	siteName: string;
	envType: EnvironmentType | 'studio';
};

export const SiteNameBox = ( { siteName, envType }: SiteNameBoxProps ) => {
	return (
		<>
			<span className="inline-block">
				{ envType === 'studio' ? <StudioBadge className="h-6" /> : <EnvironmentBadge type={ envType } className="h-6" />}
			</span>
			<span className="text-gray-600"> { siteName } </span>
		</>
	);
};
