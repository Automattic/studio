import { useConnector } from '@/data/core';
import { LegacyModelPicker, type ModelPickerProps } from './legacy-model-picker';
import { FavoritesModelPicker } from './model-favorites-picker';

export function ModelPicker( props: ModelPickerProps ) {
	const { capabilities } = useConnector();
	return capabilities.modelFavorites ? (
		<FavoritesModelPicker { ...props } />
	) : (
		<LegacyModelPicker { ...props } />
	);
}
