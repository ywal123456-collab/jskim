import type { ViewportId } from './presets.js';

export type ReferenceImageViewportMeta = {
  id: ViewportId;
  width: number;
  height: number;
};

export type ReferenceImageSourceUpload = {
  type: 'upload';
};

export type ReferenceImageSourceFigma = {
  type: 'figma';
  fileKey: string;
  nodeId: string;
  frameName: string;
  importedAt: string;
  exportScale: 1;
};

export type ReferenceImageSource =
  | ReferenceImageSourceUpload
  | ReferenceImageSourceFigma;

export type ReferenceImageMetadata = {
  schemaVersion: '1.0';
  screenId: string;
  viewport: ReferenceImageViewportMeta;
  format: 'png';
  imageFile: string;
  imageRevision: string;
  imageWidth: number;
  imageHeight: number;
  uploadedAt: string;
  source: ReferenceImageSource;
};

export type ReferenceImageStatus = 'missing' | 'current' | 'invalid';

export type PutReferenceImageResult = {
  result: 'created' | 'updated' | 'unchanged';
  screenId: string;
  viewport: ViewportId;
  imageRevision: string;
  imageWidth: number;
  imageHeight: number;
  uploadedAt: string;
  warnings?: string[];
};

export type DeleteReferenceImageResult = {
  result: 'deleted';
  screenId: string;
  viewport: ViewportId;
  warnings?: string[];
};

export type PutReferenceImageOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
  imageBytes: Buffer;
  /** missing 時のみ省略 / null。current 時は必須 */
  expectedImageRevision?: string | null;
  /**
   * 省略時は upload。Figma Import は type: figma を渡す。
   * manual upload の既定動作は変わらない。
   */
  source?: ReferenceImageSource;
};

export type DeleteReferenceImageOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
  expectedImageRevision: string;
};

export type GetReferenceImageStatusOptions = {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
};
