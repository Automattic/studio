import { CheckboxControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { LearnHowLink } from '@/components/learn-more';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import styles from './style.module.css';
import type { DataFormControlProps } from '@wordpress/dataviews';

// macOS can't trust the certificate for the user, so the action reveals it.
const isMacOS = /mac/i.test( navigator.platform );

// Until the browser trusts Studio's certificate, how to trust it.
export function CertificateTrustNotice() {
	const { data: isTrusted } = useCertificateTrust();
	const trustCertificate = useTrustCertificate();
	if ( isTrusted !== false ) {
		return null;
	}
	return (
		<>
			{ isMacOS
				? __(
						"Browsers will warn about HTTPS sites until you add Studio's certificate to Keychain Access and trust it."
				  )
				: __(
						"Browsers will warn about HTTPS sites until you trust Studio's certificate."
				  ) }{ ' ' }
			<LearnHowLink docsLinksKey="docsSslInStudio" />
			{ /* A span, not a div: it renders inside a paragraph. */ }
			<span className={ styles.helpAction }>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					size="compact"
					disabled={ trustCertificate.isPending }
					onClick={ () => trustCertificate.mutate() }
				>
					{ isMacOS ? __( 'Show certificate' ) : __( 'Trust certificate' ) }
				</Button>
			</span>
		</>
	);
}

export function EnableHttpsControl< T extends { enableHttps: boolean } >( {
	data,
	field,
	onChange,
}: DataFormControlProps< T > ) {
	const { data: isTrusted } = useCertificateTrust();
	return (
		<CheckboxControl
			__nextHasNoMarginBottom
			label={ field.label }
			checked={ data.enableHttps }
			onChange={ ( enableHttps ) => onChange( { enableHttps } as Partial< T > ) }
			help={ isTrusted === false ? <CertificateTrustNotice /> : undefined }
		/>
	);
}
