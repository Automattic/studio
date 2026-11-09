import type { ComponentType, ReactNode } from 'react';

export interface ProviderConnectionProps {
	Row: ComponentType< {
		title: string;
		badge?: ReactNode;
		description?: ReactNode;
		error?: string;
		stacked?: boolean;
		children?: ReactNode;
	} >;
	connectedBadge: ReactNode;
	connected: boolean;
	apiKeyPreview?: string | null;
	error?: string;
	onSelect: () => Promise< void >;
	onSaveKey: ( key: string | null ) => Promise< void >;
	onConnectionChange: ( connected: boolean ) => Promise< void >;
	pending: boolean;
	saving: boolean;
	formOpen: boolean;
	onFormOpenChange: ( open: boolean ) => void;
	onManageCredits: () => void;
}
