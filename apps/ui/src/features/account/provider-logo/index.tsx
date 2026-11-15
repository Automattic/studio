import { getProvider, type ProviderId } from '@studio/providers';
import { SparklesIcon } from '@/lib/icons';
import { LogoTile } from '@/lib/ui';

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
