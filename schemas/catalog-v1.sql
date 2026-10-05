-- Reader metadata mirror version 1; rebuilt from authoritative frontmatter.
CREATE TABLE documents ("schema_version" INTEGER NOT NULL CHECK(schema_version = 1), "document_id" TEXT PRIMARY KEY, "document_path" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "type" TEXT NOT NULL, "added" TEXT, "metadata_created" TEXT NOT NULL, "author" TEXT CHECK(author IS NULL OR json_valid(author)), "source" TEXT, "created" TEXT, "updated" TEXT, "kind" TEXT, "tags" TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags) = 'array'),
    frontmatter_json TEXT NOT NULL CHECK(json_valid(frontmatter_json)),
    metadata_path TEXT NOT NULL UNIQUE,
    source_sha256 TEXT NOT NULL,
    metadata_sha256 TEXT NOT NULL
);
PRAGMA user_version=1;
