import type { ViewportId } from './presets.js';

export type DeviceCaptureViewportMeta = {
  id: ViewportId;
  width: number;
  height: number;
};

export type DeviceCaptureMetadata = {
  schemaVersion: '1.0';
  screenId: string;
  stateId: string;
  viewport: DeviceCaptureViewportMeta;
  format: 'png';
  fullPage: boolean;
  deviceScaleFactor: number;
  inputRevision: string;
  imageFile: string;
  imageRevision: string;
  imageWidth: number;
  imageHeight: number;
  capturedAt: string;
};

export type DeviceCaptureStatus =
  | 'missing'
  | 'current'
  | 'stale'
  | 'invalid';

export type CollectDeviceCaptureResult = {
  status: 'created' | 'updated' | 'unchanged';
  screenId: string;
  stateId: string;
  viewport: ViewportId;
  metadataPath: string;
  imagePath: string;
  inputRevision: string;
  imageRevision: string;
  warnings?: string[];
};

export type CollectDeviceCaptureOptions = {
  rootDir: string;
  projectName: string;
  /** http://127.0.0.1:<port> （既存 collect と同じ制約） */
  baseUrl: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
  /** 注入時は wrapper が close しない */
  browser?: import('playwright').Browser;
};
