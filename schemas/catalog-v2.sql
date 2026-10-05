-- Reader catalog SQL projection version 2; source metadata remains authoritative.
CREATE TABLE documents ("schema_version" INTEGER CHECK(schema_version = 1), "document_id" TEXT PRIMARY KEY, "document_path" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "type" TEXT NOT NULL, "added" TEXT, "metadata_created" TEXT NOT NULL, "author" TEXT CHECK(author IS NULL OR json_valid(author)), "source" TEXT, "created" TEXT, "updated" TEXT, "kind" TEXT, "tags" TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags) = 'array'), "frontmatter_schema_version" INTEGER CHECK(frontmatter_schema_version = 1), "document_revision" INTEGER CHECK(document_revision >= 1),
    frontmatter_json TEXT NOT NULL CHECK(json_valid(frontmatter_json)),
    metadata_path TEXT NOT NULL UNIQUE,
    source_sha256 TEXT NOT NULL,
    metadata_sha256 TEXT NOT NULL
);
PRAGMA user_version=2;
