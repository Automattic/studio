import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const createPreviewSite = createAsyncThunk(
	'preview/createPreviewSite',
	async ( site: SiteDetails, { rejectWithValue } ) => {
		try {
			await getIpcApi().createPreviewSite( site );
		} catch ( error ) {
			return rejectWithValue(
				error instanceof Error ? error.message : 'Failed to create preview site'
			);
		}
	}
);

window.ipcListener.subscribe( 'preview-output', ( _evt, { siteId, output } ) => {
	previewSlice.actions.previewSiteProgress( { siteId, output } );
} );

window.ipcListener.subscribe( 'preview-success', ( _evt, { siteId } ) => {
	previewSlice.actions.previewSiteSuccess( { siteId } );
} );

window.ipcListener.subscribe( 'preview-error', ( _evt, { siteId, error } ) => {
	previewSlice.actions.previewSiteError( { siteId, error } );
} );

type PreviewSite = {
	id: string;
	status: 'creating' | 'ready' | 'error';
};

type PreviewSitesState = {
	sites: PreviewSite[];
};

const initialState: PreviewSitesState = {
	sites: [],
};

const previewSlice = createSlice( {
	name: 'preview',
	initialState,
	reducers: {
		previewSiteSuccess: ( state, action: PayloadAction< { siteId: PreviewSite[ 'id' ] } > ) => {
			for ( const site of state.sites ) {
				if ( site.id === action.payload.siteId ) {
					site.status = 'ready';
				}
			}
		},
		previewSiteProgress: (
			state,
			action: PayloadAction< { siteId: PreviewSite[ 'id' ]; output: string } >
		) => {
			for ( const site of state.sites ) {
				if ( site.id === action.payload.siteId ) {
					site.status = 'creating';
				}
			}
		},
		previewSiteError: (
			state,
			action: PayloadAction< { siteId: PreviewSite[ 'id' ]; error: string } >
		) => {
			for ( const site of state.sites ) {
				if ( site.id === action.payload.siteId ) {
					site.status = 'error';
				}
			}
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( createPreviewSite.pending, ( state, action ) => {
				state.sites.push( {
					id: action.meta.arg.id,
					status: 'creating',
				} );
			} )
			.addCase( createPreviewSite.rejected, ( state, action ) => {
				for ( const site of state.sites ) {
					if ( site.id === action.meta.arg.id ) {
						site.status = 'error';
					}
				}
			} );
	},
} );

export default previewSlice.reducer;
