import { LogoTile } from '@studio/ds';
import { SparklesIcon } from '@studio/ds/icons';
import { getProvider, type ProviderId } from '@studio/providers';

export function ProviderLogo( {
	provider,
	className,
}: {
	provider: ProviderId;
	className?: string;
} ) {
	const { logo, icon } = getProvider( provider );
	return (
		<LogoTile svg={ logo } className={ className }>
			{ icon ? <span dangerouslySetInnerHTML={ { __html: icon } } /> : <SparklesIcon /> }
		</LogoTile>
	);
}
