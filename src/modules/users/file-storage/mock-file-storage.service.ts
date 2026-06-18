import { Injectable } from '@nestjs/common';
import { FileStorageService, StoredFile } from './file-storage.service';

@Injectable()
export class MockFileStorageService extends FileStorageService {
  async uploadFile(file: {
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<StoredFile> {
    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const timestamp = Date.now();
    const key = `profile-images/${timestamp}-${safeName || 'upload'}`;

    return {
      key,
      url: `https://mock-storage.ikash.local/${key}`,
    };
  }
}
