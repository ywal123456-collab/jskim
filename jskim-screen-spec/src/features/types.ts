export type ScreenFeatureFileSchemaVersion = '1.0';

export type ScreenFeature = {
  featureId: string;
  name: string;
  description?: string;
  displayOrder: number;
  screenIds: string[];
};

export type ScreenFeatureFile = {
  schemaVersion: ScreenFeatureFileSchemaVersion;
  features: ScreenFeature[];
};

export type LoadScreenFeaturesResult = {
  /** ファイルが存在したか */
  sourceExists: boolean;
  /** displayOrder → featureId でソート済み */
  features: ScreenFeature[];
  /** knownScreenIds のうちどの feature にも属さないもの（入力順を維持） */
  ungroupedScreenIds: string[];
  document: ScreenFeatureFile;
};

export type PersistScreenFeaturesOptions = {
  rootDir: string;
  projectName: string;
  document: ScreenFeatureFile;
  knownScreenIds: readonly string[];
};

export type PersistScreenFeaturesResult = {
  status: 'created' | 'updated' | 'unchanged';
  relativePath: string;
};
