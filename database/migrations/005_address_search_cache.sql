CREATE TABLE IF NOT EXISTS address_search_cache (
  query_hash RAW(32) PRIMARY KEY,
  result_json VARCHAR2(4000 CHAR) NOT NULL CHECK (result_json IS JSON),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
)
/
