import { __experimentalHeading as Heading } from '@wordpress/components';
import { sprintf, __ } from '@wordpress/i18n';
import { type CSSProperties, type ReactNode } from 'react';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { SiteNameBox } from 'src/modules/sync/components/site-name-box';
import type { EnvironmentType } from 'src/modules/sync/lib/environment-utils';

type SyncModalSite = {
	name: string;
	envType: EnvironmentType | 'studio';
};

type SyncModalShellProps = {
	title: string;
	description: string;
	subtitle: string;
	source: SyncModalSite;
	destination: SyncModalSite;
	onRequestClose: () => void;
	children: ReactNode;
	footer: ReactNode;
	contentClassName?: string;
	contentStyle?: CSSProperties;
};

export function SyncModalShell( {
	title,
	description,
	subtitle,
	source,
	destination,
	onRequestClose,
	children,
	footer,
	contentClassName,
	contentStyle,
}: SyncModalShellProps ) {
	return (
		<Modal
			className="w-3/5 min-w-[550px] max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ title }
		>
			<div className={ contentClassName } style={ contentStyle }>
				<div className="px-8 pb-6 pt-1">{ description }</div>
				<div className="px-8">
					<span className="sr-only">
						{ /* translators: first %s is the source site name, second %s is the destination site name */ }
						{ sprintf( __( 'From %s to %s' ), source.name, destination.name ) }
					</span>
					<div
						aria-hidden="true"
						className="flex max-w-full overflow-hidden pb-6 border-b border-frame-border"
					>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">
								<SiteNameBox siteName={ source.name } envType={ source.envType } />
							</div>
						</div>
						<div className="w-[50px] flex items-center justify-center text-frame-text-secondary">
							<RightArrowIcon />
						</div>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">
								<SiteNameBox siteName={ destination.name } envType={ destination.envType } />
							</div>
						</div>
					</div>
				</div>
				<Heading
					level={ 2 }
					lineHeight="28px"
					size={ 11 }
					weight={ 500 }
					upperCase
					className="px-8 pt-5 pb-3"
				>
					{ subtitle }
				</Heading>
				{ children }
				<div className="px-8 py-4 absolute left-0 right-0 bottom-0 bg-frame z-10 border-t border-frame-border">
					{ footer }
				</div>
			</div>
		</Modal>
	);
}
