CREATE TABLE IF NOT EXISTS app_user (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demo_key VARCHAR2(40 CHAR) NOT NULL UNIQUE,
  display_name VARCHAR2(80 CHAR) NOT NULL,
  role VARCHAR2(8 CHAR) NOT NULL CHECK (role IN ('CITIZEN', 'OPERATOR'))
)
/
CREATE TABLE IF NOT EXISTS issue_category (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR2(30 CHAR) NOT NULL UNIQUE,
  name VARCHAR2(80 CHAR) NOT NULL UNIQUE
)
/
CREATE TABLE IF NOT EXISTS issue_location (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  neighborhood VARCHAR2(80 CHAR) NOT NULL,
  address VARCHAR2(200 CHAR) NOT NULL,
  latitude NUMBER,
  longitude NUMBER,
  CONSTRAINT issue_location_coords_ck CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  )
)
/
CREATE TABLE IF NOT EXISTS issue (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id NUMBER NOT NULL REFERENCES app_user(id),
  category_id NUMBER NOT NULL REFERENCES issue_category(id),
  location_id NUMBER NOT NULL UNIQUE REFERENCES issue_location(id),
  title VARCHAR2(100 CHAR) NOT NULL,
  description VARCHAR2(1000 CHAR) NOT NULL,
  severity VARCHAR2(6 CHAR) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status VARCHAR2(11 CHAR) DEFAULT 'OPEN' NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  request_key VARCHAR2(36 CHAR) NOT NULL,
  request_hash RAW(32) NOT NULL,
  photo BLOB,
  photo_mime VARCHAR2(10 CHAR) CHECK (photo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  is_sample NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_sample IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT issue_request_uq UNIQUE (author_id, request_key)
)
/
CREATE TABLE IF NOT EXISTS issue_confirmation (
  issue_id NUMBER REFERENCES issue(id),
  user_id NUMBER REFERENCES app_user(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT issue_confirmation_pk PRIMARY KEY (issue_id, user_id)
)
/
CREATE TABLE IF NOT EXISTS issue_status_history (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id NUMBER NOT NULL REFERENCES issue(id),
  actor_id NUMBER NOT NULL REFERENCES app_user(id),
  previous_status VARCHAR2(11 CHAR) CHECK (previous_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  new_status VARCHAR2(11 CHAR) NOT NULL CHECK (new_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  note VARCHAR2(500 CHAR),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT issue_history_transition_ck CHECK (
    (previous_status IS NULL AND new_status = 'OPEN') OR
    (previous_status IS NOT NULL AND previous_status = 'OPEN' AND new_status = 'IN_PROGRESS') OR
    (previous_status IS NOT NULL AND previous_status = 'IN_PROGRESS' AND new_status = 'RESOLVED')
  )
)
/
CREATE INDEX IF NOT EXISTS issue_created_ix ON issue (created_at DESC, id DESC)
/
CREATE INDEX IF NOT EXISTS issue_category_ix ON issue (category_id, created_at DESC)
/
CREATE INDEX IF NOT EXISTS issue_status_ix ON issue (status, created_at DESC)
/
CREATE INDEX IF NOT EXISTS issue_confirmation_user_ix ON issue_confirmation (user_id)
/
CREATE INDEX IF NOT EXISTS issue_history_issue_ix ON issue_status_history (issue_id, created_at, id)
/
CREATE INDEX IF NOT EXISTS issue_history_actor_ix ON issue_status_history (actor_id)
/
