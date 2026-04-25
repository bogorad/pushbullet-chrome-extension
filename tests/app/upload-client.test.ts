import { beforeEach, describe, expect, it, vi } from 'vitest';

const debugLoggerMock = vi.hoisted(() => ({
  api: vi.fn(),
  general: vi.fn(),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: debugLoggerMock,
}));

import {
  requestFileUpload,
  sendFilePush,
  uploadFileToServer,
} from '../../src/app/api/client';

describe('file upload API helpers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requests upload authorization, uploads the file, and sends the file push', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_name: 'report.txt',
        file_type: 'text/plain',
        file_url: 'https://files.example/report.txt',
        upload_url: 'https://uploads.example',
        data: {
          key: 'uploads/report.txt',
          acl: 'public-read',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ iden: 'push-1' }), { status: 200 }));

    const uploadData = await requestFileUpload('api-key', 'report.txt', 'text/plain');
    await uploadFileToServer(uploadData, new Blob(['hello'], { type: 'text/plain' }));
    await sendFilePush('api-key', {
      file_name: uploadData.file_name,
      file_type: uploadData.file_type,
      file_url: uploadData.file_url,
      body: 'Quarterly report',
      email: 'alice@example.com',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.pushbullet.com/v2/upload-request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          file_name: 'report.txt',
          file_type: 'text/plain',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://uploads.example',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.pushbullet.com/v2/pushes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'file',
          file_name: 'report.txt',
          file_type: 'text/plain',
          file_url: 'https://files.example/report.txt',
          body: 'Quarterly report',
          email: 'alice@example.com',
        }),
      }),
    );
  });

  it('returns a structured error when upload authorization fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: 'Upload request rejected',
      },
    }), {
      status: 400,
      statusText: 'Bad Request',
    }));

    await expect(
      requestFileUpload('api-key', 'report.txt', 'text/plain'),
    ).rejects.toMatchObject({
      code: 'upload_request_failed',
      stage: 'upload-request',
      status: 400,
      message: 'Upload request rejected',
    });
  });
});
