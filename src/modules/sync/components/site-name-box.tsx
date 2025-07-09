import { EnvironmentBadge } from 'src/components/environment-badge';
import type { EnvironmentType } from 'src/components/environment-badge';

type SiteNameBoxProps = {
	siteName: string;
	envType: EnvironmentType;
};

export const SiteNameBox = ( { siteName, envType }: SiteNameBoxProps ) => {
	return (
		<>
			<span className="inline-block">
				<EnvironmentBadge type={ envType } className="h-6" />
			</span>
			<span className="text-gray-600"> { siteName } </span>
		</>
	);
};
