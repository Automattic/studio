import { BackupContents } from '../types';
import { DefaultImporter } from './Importer';

export class JetpackImporter extends DefaultImporter {
	constructor( backup: BackupContents ) {
		super( backup );
	}
}
