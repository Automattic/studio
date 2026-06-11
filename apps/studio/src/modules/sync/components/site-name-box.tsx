import { EnvironmentBadge, StudioBadge } from 'src/modules/sync/components/environment-badge';
import type { EnvironmentType } from '@studio/common/lib/sync/environment-utils';

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
