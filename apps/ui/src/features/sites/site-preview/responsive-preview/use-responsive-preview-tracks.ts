import {
	TRACKS_EVENTS,
	type TracksPreviewSizeBucket,
	type TracksResponsivePreviewAction,
	type TracksResponsivePreviewProps,
} from '@studio/common/lib/record-tracks-event';
import { useCallback } from 'react';
import { useConnector } from '@/data/core';
import { devicePresets } from './settings';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';

export type ResponsivePreviewSize = Pick<
	ResponsivePreviewSettings,
	'preset' | 'width' | 'height'
>;

function getSizeBucket( size: number ): TracksPreviewSizeBucket {
	if ( size < 600 ) return 'under_600';
	if ( size < 1024 ) return '600_to_1023';
	return size < 1440 ? '1024_to_1439' : '1440_plus';
}

export function useResponsivePreviewTracks( active: boolean ) {
	const connector = useConnector();
	return useCallback(
		(
			action: TracksResponsivePreviewAction,
			previous: ResponsivePreviewSize,
			next: ResponsivePreviewSize
		) => {
			if ( ! active ) return;
			if (
				action === 'preset_change'
					? previous.preset === next.preset
					: previous.width === next.width && previous.height === next.height
			)
				return;
			const props: TracksResponsivePreviewProps = {
				action,
				preset_category:
					devicePresets.find( ( preset ) => preset.name === next.preset )?.category ?? 'custom',
				width_bucket: getSizeBucket( next.width ),
				height_bucket: getSizeBucket( next.height ),
			};
			try {
				void connector
					.trackEvent( TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED, props )
					.catch( () => undefined );
			} catch {
				// Telemetry must not block responsive controls.
			}
		},
		[ active, connector ]
	);
}
