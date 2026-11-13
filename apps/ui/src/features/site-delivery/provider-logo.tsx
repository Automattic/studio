import { getSitesDescriptor, type SitesProviderId } from '@studio/providers';
import styles from './style.module.css';
export function ProviderLogo( {
	provider,
	branded = false,
	compact = false,
	...props
}: {
	provider: SitesProviderId;
	branded?: boolean;
	compact?: boolean;
} & React.ComponentProps< 'svg' > ) {
	const logo = getSitesDescriptor( provider ).logo;
	const brandedSize = logo.brandedSize ?? 16;
	const size = branded ? brandedSize * ( compact ? 0.75 : 1 ) : 16;
	const icon = (
		<svg
			width={ size }
			height={ size }
			viewBox={ logo.viewBox }
			fill="currentColor"
			aria-hidden="true"
			{ ...props }
		>
			<path d={ logo.path } />
		</svg>
	);
	return branded ? (
		<span
			className={ styles.providerBrandSquare }
			data-compact={ compact || undefined }
			data-brand-color={ logo.color }
			aria-hidden="true"
		>
			{ icon }
		</span>
	) : (
		icon
	);
}
