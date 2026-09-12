import { describe, expect, it } from 'vitest';

import { projectAcceptedChapterContents } from './acceptedChangeSet';

describe('projectAcceptedChapterContents', () => {
  it('同步 change set 中每个章节，而不是只取当前预览资产', () => {
    expect(
      projectAcceptedChapterContents([
        { asset_type: 'chapter', asset_id: 'V1C1', revised: '第一章正文' },
        { asset_type: 'chapter', asset_id: 'V1C2', revised: '第二章正文' },
        { asset_type: 'outline', asset_id: 'outline', revised: '大纲' },
      ]),
    ).toEqual({ V1C1: '第一章正文', V1C2: '第二章正文' });
  });
});
