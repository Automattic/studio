import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const checkCertificateTrust = createAsyncThunk( 'certificateTrust/check', async () => {
	return await getIpcApi().isCATrusted();
} );

interface CertificateTrustState {
	isTrusted: boolean;
}

const initialState: CertificateTrustState = {
	isTrusted: false,
};

const certificateTrustSlice = createSlice( {
	name: 'certificateTrust',
	initialState,
	reducers: {},
	extraReducers: ( builder ) => {
		builder
			.addCase( checkCertificateTrust.fulfilled, ( state, action ) => {
				state.isTrusted = action.payload;
			} )
			.addCase( checkCertificateTrust.rejected, ( state ) => {
				state.isTrusted = false;
			} );
	},
	selectors: {
		selectIsRootCATrusted: ( state ) => state.isTrusted,
	},
} );

export const { selectIsRootCATrusted } = certificateTrustSlice.selectors;
export default certificateTrustSlice.reducer;
