export interface Segment {
  label: string;
  points: [number, number][];
}

export interface ImageRecord {
  id: string;
  path: string;
  name: string;
  width: number;
  height: number;
  segments: Segment[];
  selected: boolean;
  reviewTag: string;
  phash: string | null;
}

declare global {
  interface Window {
    datasetApi: {
      chooseDataset(): Promise<string | null>;
      scanDataset(folder: string): Promise<ImageRecord[]>;
      thumbnail(file: string, size: number, roi: boolean): Promise<string | null>;
      chooseExport(): Promise<string | null>;
      exportDataset(options: { records: ImageRecord[]; output: string; valRatio: number; splitEnabled: boolean }): Promise<string>;
      revealPath(file: string): Promise<void>;
      deduplicate(records: ImageRecord[], similarity: number): Promise<{ records: ImageRecord[]; removed: number }>;
      loadReviewTags(): Promise<Record<string, string>>;
      saveReviewTags(entries: Record<string, string>): Promise<void>;
    };
  }
}
