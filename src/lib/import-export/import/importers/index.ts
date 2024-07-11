import { BackupContents } from '../types';
import { Importer } from './Importer';
import { JetpackImporter } from './jetpack-importer';

export * from './Importer';
export * from './jetpack-importer';

export const allImporters: { [ key: string ]: new ( contents: BackupContents ) => Importer } = {
	JetpackValidator: JetpackImporter,
};
