import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_FILE_MB, MAX_UPLOAD_FILES } from './constants';
import { emptyFileText, tooLargeFileText, tooManyFilesText, unsupportedFileText } from './constants/messages';
import { validateUploadFiles } from './validateUploadFiles';

const BYTES_PER_MB = 1024 * 1024;

function makeFile(name, size = 100) {
  return { name, size };
}

describe('validateUploadFiles', () => {
  it('accepts valid files of every allowed kind', () => {
    const picked = [makeFile('a.csv'), makeFile('b.xls'), makeFile('c.webp')];

    const result = validateUploadFiles([], picked);

    expect(result.accepted).toEqual(picked);
    expect(result.rejected).toEqual([]);
  });

  it('rejects an empty file with its reason', () => {
    const result = validateUploadFiles([], [makeFile('report.csv', 0)]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ name: 'report.csv', message: emptyFileText('report.csv') }]);
  });

  it('rejects an unsupported format', () => {
    const result = validateUploadFiles([], [makeFile('notes.txt'), makeFile('noextension')]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { name: 'notes.txt', message: unsupportedFileText('notes.txt') },
      { name: 'noextension', message: unsupportedFileText('noextension') },
    ]);
  });

  it('accepts an extension in upper case', () => {
    const file = makeFile('DATA.CSV');

    expect(validateUploadFiles([], [file]).accepted).toEqual([file]);
  });

  it('rejects a file over the size limit and accepts one exactly at it', () => {
    const tooLarge = makeFile('trials.xlsx', 14.2 * BYTES_PER_MB);
    const atLimit = makeFile('limit.xlsx', MAX_UPLOAD_FILE_MB * BYTES_PER_MB);

    const result = validateUploadFiles([], [tooLarge, atLimit]);

    expect(result.accepted).toEqual([atLimit]);
    expect(result.rejected).toEqual([
      { name: 'trials.xlsx', message: tooLargeFileText('trials.xlsx', 14.2) },
    ]);
  });

  it('skips the files beyond the maximum and reports the limit once', () => {
    const current = Array.from({ length: MAX_UPLOAD_FILES - 1 }, (_, index) => makeFile(`current-${index}.csv`));
    const picked = [makeFile('fits.csv'), makeFile('extra-1.csv'), makeFile('extra-2.csv')];

    const result = validateUploadFiles(current, picked);

    expect(result.accepted).toEqual([picked[0]]);
    expect(result.rejected).toEqual([{ name: '', message: tooManyFilesText(MAX_UPLOAD_FILES) }]);
  });

  it('ignores a duplicate name silently, against current files and within the pick', () => {
    const current = [makeFile('a.csv')];
    const picked = [makeFile('a.csv'), makeFile('b.csv'), makeFile('b.csv')];

    const result = validateUploadFiles(current, picked);

    expect(result.accepted).toEqual([picked[1]]);
    expect(result.rejected).toEqual([]);
  });
});
