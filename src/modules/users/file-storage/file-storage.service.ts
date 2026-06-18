export interface StoredFile {
  key: string;
  url: string;
}

export abstract class FileStorageService {
  abstract uploadFile(file: {
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<StoredFile>;
}
