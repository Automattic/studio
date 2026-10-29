import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { SiteCard, getWebsiteThumbnailUrl } from '@/features/site-card';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/lib/ui';
import { websiteAddress } from './options';
import { ErrorMessage } from './parts';
import type { SyncSite } from '@/data/core';
import type { RefObject } from 'react';

export function DisconnectSiteDialog( {
	website,
	disabled,
	pending,
	error,
	returnFocus,
	onClose,
	onConfirm,
}: {
	website: SyncSite;
	disabled: boolean;
	pending: boolean;
	error: Error | null;
	returnFocus: RefObject< HTMLButtonElement | null >;
	onClose: () => void;
	onConfirm: () => void;
} ) {
	const cancel = useRef< HTMLButtonElement >( null );
	return (
		<AlertDialog open onOpenChange={ ( next ) => ! next && ! pending && onClose() }>
			<DialogContent
				layout="confirmation"
				initialFocus={ cancel }
				finalFocus={ returnFocus }
				closeButtonDisabled={ pending }
			>
				<DialogHeader>
					<DialogTitle>{ __( 'Disconnect website?' ) }</DialogTitle>
					<DialogDescription tone="default">
						{ __(
							'You’ll need to connect a website again to publish or pull changes. Your local site and live website will stay unchanged.'
						) }
					</DialogDescription>
				</DialogHeader>
				<SiteCard
					title={ websiteAddress( website ) }
					thumbnailUrl={ getWebsiteThumbnailUrl( website.url ) }
					updatedAt={ website.lastPushTimestamp }
					description={ __( 'Not published yet' ) }
				/>
				<ErrorMessage error={ error } />
				<DialogFooter>
					<Button ref={ cancel } variant="outline" disabled={ pending } onClick={ onClose }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="destructive"
						disabled={ disabled }
						loading={ pending }
						onClick={ onConfirm }
					>
						{ __( 'Disconnect' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
