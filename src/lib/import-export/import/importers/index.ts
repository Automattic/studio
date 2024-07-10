import { BackupContents } from '../types';
import { Importer } from './Importer';
import { JetpackImporter } from './JetpackImporter';

export * from './Importer';
export * from './JetpackImporter';

export const allImporters: { [ key: string ]: new ( contents: BackupContents ) => Importer } = {
	JetpackValidator: JetpackImporter,
};
