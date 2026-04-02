import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { DynamicStylesheet } from 'src/components/dynamic-stylesheet';
import { DotGrid } from 'src/components/new-ui/dot-grid';
import { getWordpressStylesHref } from 'src/components/wordpress-styles';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

export default function DefaultErrorFallback() {
	const { __, isRTL } = useI18n();
	const isRtl = isRTL();
	const locale = DEFAULT_LOCALE;
	const href = getWordpressStylesHref( isRtl );

	const openLocalizedSupport = () => {
		getIpcApi().openURL( `https://wordpress.com/${ locale }/support/contact` );
	};

	return (
		<div dir={ isRtl ? 'rtl' : 'ltr' }>
			<DynamicStylesheet id="wordpress-components-style-error-fallback" href={ href } />
			<div
				className={ cx(
					'h-screen bg-chrome flex items-center justify-center relative overflow-hidden',
					isWindows() && 'pt-titlebar-win'
				) }
			>
				<div className="absolute inset-x-0 top-0 h-[40px] app-drag-region" />
				<div className="absolute inset-0 text-chrome-text-tertiary">
					<DotGrid opacity={ 0.5 } />
				</div>
				<div className="relative z-10 max-w-md px-8">
					<div className="text-chrome-text text-[54px] font-normal leading-[54px]">
						{ __( 'Uh oh!' ) }
					</div>
					<div className="text-chrome-text font-normal text-xl leading-[28px] mt-2">
						{ __( "Something's broken." ) }
					</div>
					<div className="mt-6 mb-8 text-chrome-text-secondary leading-[18px] text-[13px]">
						<p>{ __( 'We\u2019ve logged the issue to help us track down the problem.' ) }</p>
						<p>
							{ __( 'Try restarting the app, if the problem persists' ) }{ ' ' }
							<Button
								className="text-[13px] !text-frame-theme underline"
								aria-label={ __( 'Help' ) }
								onClick={ openLocalizedSupport }
								variant="link"
							>
								{ __( 'contact support.' ) }
							</Button>
						</p>
					</div>
					<div>
						<Button
							className="bg-frame-theme hover:text-white text-white"
							variant="primary"
							onClick={ () => window.location.reload() }
						>
							{ __( 'Restart' ) }
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
