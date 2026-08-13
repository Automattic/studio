import { EnvironmentBadge, StudioBadge } from '@/components/selective-sync/environment-badge';
import type { EnvironmentType } from '@/components/selective-sync/lib/environment-utils';

type SiteNameBoxProps = {
	siteName: string;
	envType: EnvironmentType | 'studio';
};

export const SiteNameBox = ( { siteName, envType }: SiteNameBoxProps ) => {
	return (
		<>
			<span className="inline-block">
				{ envType === 'studio' ? <StudioBadge /> : <EnvironmentBadge type={ envType } /> }
			</span>
			<span className="text-frame-text-secondary"> { siteName } </span>
		</>
	);
};
