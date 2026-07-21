export const DESCRIPTION_SCHEMA_V1_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json';

export const DESCRIPTION_SCHEMA_V1_1_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.1.schema.json';

export const DESCRIPTION_SCHEMA_V1_2_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.2.schema.json';

export const DESCRIPTION_SCHEMA_V1_3_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.3.schema.json';

/** v1.0 の $schema URI を v1.1 に変換する（他の URI はそのまま維持する） */
export function upgradeSchemaUriToV11(schemaUri: string | undefined): string | undefined {
  if (schemaUri === DESCRIPTION_SCHEMA_V1_URI) {
    return DESCRIPTION_SCHEMA_V1_1_URI;
  }
  return schemaUri;
}

/** v1.0 / v1.1 の $schema URI を v1.2 に変換する（他の URI はそのまま維持する） */
export function upgradeSchemaUriToV12(schemaUri: string | undefined): string | undefined {
  if (
    schemaUri === DESCRIPTION_SCHEMA_V1_URI ||
    schemaUri === DESCRIPTION_SCHEMA_V1_1_URI
  ) {
    return DESCRIPTION_SCHEMA_V1_2_URI;
  }
  return schemaUri;
}
