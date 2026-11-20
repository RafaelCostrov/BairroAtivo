BEGIN
  MERGE INTO issue_location target USING (
    SELECT i.location_id,
      CASE i.request_key
        WHEN 'b1000000-0000-4000-8000-000000000001' THEN -23.55050
        WHEN 'b1000000-0000-4000-8000-000000000002' THEN -23.55220
        WHEN 'b1000000-0000-4000-8000-000000000003' THEN -23.55140
        WHEN 'b1000000-0000-4000-8000-000000000004' THEN -23.55300
        WHEN 'b1000000-0000-4000-8000-000000000005' THEN -23.55080
      END latitude,
      CASE i.request_key
        WHEN 'b1000000-0000-4000-8000-000000000001' THEN -46.63330
        WHEN 'b1000000-0000-4000-8000-000000000002' THEN -46.63420
        WHEN 'b1000000-0000-4000-8000-000000000003' THEN -46.63250
        WHEN 'b1000000-0000-4000-8000-000000000004' THEN -46.63150
        WHEN 'b1000000-0000-4000-8000-000000000005' THEN -46.63550
      END longitude
    FROM issue i WHERE i.is_sample = 1
  ) source ON (target.id = source.location_id)
  WHEN MATCHED THEN UPDATE SET target.latitude = source.latitude, target.longitude = source.longitude
    WHERE target.latitude IS NULL AND source.latitude IS NOT NULL;
END;
/
CREATE OR REPLACE PACKAGE pkg_issues AS
  PROCEDURE create_issue(
    p_author_id IN NUMBER, p_category_id IN NUMBER, p_title IN VARCHAR2,
    p_description IN VARCHAR2, p_severity IN VARCHAR2, p_neighborhood IN VARCHAR2,
    p_address IN VARCHAR2, p_latitude IN NUMBER, p_longitude IN NUMBER,
    p_request_key IN VARCHAR2, p_request_hash IN RAW, p_photo IN BLOB,
    p_photo_mime IN VARCHAR2, p_is_sample IN NUMBER, p_issue_id OUT NUMBER,
    p_created OUT NUMBER, p_postal_code IN VARCHAR2 DEFAULT NULL
  );
  PROCEDURE locate_issue(p_issue_id IN NUMBER, p_actor_id IN NUMBER, p_latitude IN NUMBER, p_longitude IN NUMBER, p_neighborhood IN VARCHAR2 DEFAULT NULL, p_address IN VARCHAR2 DEFAULT NULL, p_postal_code IN VARCHAR2 DEFAULT NULL);
  PROCEDURE update_issue_status(
    p_issue_id IN NUMBER, p_actor_id IN NUMBER, p_new_status IN VARCHAR2, p_note IN VARCHAR2
  );
  PROCEDURE add_confirmation(p_issue_id IN NUMBER, p_user_id IN NUMBER);
  PROCEDURE remove_confirmation(p_issue_id IN NUMBER, p_user_id IN NUMBER);
  FUNCTION calculate_priority(p_severity IN VARCHAR2, p_confirmation_count IN NUMBER)
    RETURN NUMBER DETERMINISTIC;
  PROCEDURE get_community_metrics(
    p_totals OUT SYS_REFCURSOR, p_categories OUT SYS_REFCURSOR, p_neighborhoods OUT SYS_REFCURSOR
  );
END pkg_issues;
/
CREATE OR REPLACE PACKAGE BODY pkg_issues AS
  PROCEDURE require_role(p_user_id IN NUMBER, p_role IN VARCHAR2) IS
    v_role app_user.role%TYPE;
  BEGIN
    SELECT role INTO v_role FROM app_user WHERE id = p_user_id;
    IF v_role <> p_role THEN
      raise_application_error(-20001, 'Role not permitted');
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      raise_application_error(-20001, 'Unknown identity');
  END;

  FUNCTION lock_issue(p_issue_id IN NUMBER) RETURN issue.status%TYPE IS
    v_status issue.status%TYPE;
  BEGIN
    SELECT status INTO v_status FROM issue WHERE id = p_issue_id FOR UPDATE;
    RETURN v_status;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      raise_application_error(-20002, 'Issue not found');
  END;

  PROCEDURE create_issue(
    p_author_id IN NUMBER, p_category_id IN NUMBER, p_title IN VARCHAR2,
    p_description IN VARCHAR2, p_severity IN VARCHAR2, p_neighborhood IN VARCHAR2,
    p_address IN VARCHAR2, p_latitude IN NUMBER, p_longitude IN NUMBER,
    p_request_key IN VARCHAR2, p_request_hash IN RAW, p_photo IN BLOB,
    p_photo_mime IN VARCHAR2, p_is_sample IN NUMBER, p_issue_id OUT NUMBER,
    p_created OUT NUMBER, p_postal_code IN VARCHAR2 DEFAULT NULL
  ) IS
    v_location_id issue_location.id%TYPE;
    v_existing_hash issue.request_hash%TYPE;
    v_category_id issue_category.id%TYPE;
  BEGIN
    SAVEPOINT before_create_issue;
    require_role(p_author_id, 'CITIZEN');

    IF nvl(length(trim(p_title)), 0) NOT BETWEEN 5 AND 100 OR
       length(trim(p_description)) > 1000 OR
       nvl(length(trim(p_neighborhood)), 0) NOT BETWEEN 2 AND 80 OR
       nvl(length(trim(p_address)), 0) NOT BETWEEN 4 AND 200 OR
       p_severity IS NULL OR p_severity NOT IN ('LOW', 'MEDIUM', 'HIGH') OR
       (p_postal_code IS NOT NULL AND NOT regexp_like(p_postal_code, '^[0-9]{8}$')) OR
       (p_latitude IS NULL AND p_longitude IS NOT NULL) OR
       (p_latitude IS NOT NULL AND p_longitude IS NULL) OR
       p_latitude IS NULL OR p_longitude IS NULL OR
       p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 OR
       nvl(length(p_request_key), 0) <> 36 OR nvl(utl_raw.length(p_request_hash), 0) <> 32 OR
       p_is_sample IS NULL OR p_is_sample NOT IN (0, 1) THEN
      raise_application_error(-20003, 'Invalid issue data');
    END IF;

    IF (p_photo IS NULL AND p_photo_mime IS NOT NULL) OR
       (p_photo IS NOT NULL AND (p_photo_mime IS NULL OR
        p_photo_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') OR
        dbms_lob.getlength(p_photo) NOT BETWEEN 1 AND 5242880)) THEN
      raise_application_error(-20008, 'Invalid photograph');
    END IF;

    BEGIN
      SELECT id INTO v_category_id FROM issue_category WHERE id = p_category_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        raise_application_error(-20003, 'Invalid category');
    END;

    INSERT INTO issue_location (neighborhood, address, latitude, longitude, postal_code)
    VALUES (trim(p_neighborhood), trim(p_address), p_latitude, p_longitude, p_postal_code)
    RETURNING id INTO v_location_id;

    BEGIN
      INSERT INTO issue (
        author_id, category_id, location_id, title, description, severity,
        request_key, request_hash, photo, photo_mime, is_sample
      ) VALUES (
        p_author_id, v_category_id, v_location_id, trim(p_title), trim(p_description), p_severity,
        p_request_key, p_request_hash, p_photo, p_photo_mime, p_is_sample
      ) RETURNING id INTO p_issue_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK TO before_create_issue;
        SELECT id, request_hash INTO p_issue_id, v_existing_hash
        FROM issue WHERE author_id = p_author_id AND request_key = p_request_key;
        IF v_existing_hash <> p_request_hash THEN
          raise_application_error(-20007, 'Request key reused with different data');
        END IF;
        p_created := 0;
        RETURN;
    END;

    INSERT INTO issue_status_history (issue_id, actor_id, new_status)
    VALUES (p_issue_id, p_author_id, 'OPEN');
    p_created := 1;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO before_create_issue;
      RAISE;
  END;

  PROCEDURE locate_issue(p_issue_id IN NUMBER, p_actor_id IN NUMBER, p_latitude IN NUMBER, p_longitude IN NUMBER, p_neighborhood IN VARCHAR2 DEFAULT NULL, p_address IN VARCHAR2 DEFAULT NULL, p_postal_code IN VARCHAR2 DEFAULT NULL) IS
    v_location_id NUMBER;
    v_author_id NUMBER;
    v_role app_user.role%TYPE;
  BEGIN
    IF p_latitude IS NULL OR p_longitude IS NULL OR
      p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
      raise_application_error(-20003, 'Invalid coordinates');
    END IF;
    BEGIN
      SELECT role INTO v_role FROM app_user WHERE id = p_actor_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      raise_application_error(-20001, 'Unknown identity');
    END;
    BEGIN
      SELECT location_id, author_id INTO v_location_id, v_author_id
      FROM issue WHERE id = p_issue_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      raise_application_error(-20002, 'Issue not found');
    END;
    IF v_author_id <> p_actor_id AND v_role <> 'OPERATOR' THEN
      raise_application_error(-20001, 'Location change not permitted');
    END IF;
    UPDATE issue_location SET latitude = p_latitude, longitude = p_longitude
      WHERE id = v_location_id AND latitude IS NULL AND longitude IS NULL;
    IF sql%rowcount = 0 THEN
      raise_application_error(-20007, 'Location already provided');
    END IF;
    UPDATE issue SET updated_at = systimestamp WHERE id = p_issue_id;
  END;

  PROCEDURE update_issue_status(
    p_issue_id IN NUMBER, p_actor_id IN NUMBER, p_new_status IN VARCHAR2, p_note IN VARCHAR2
  ) IS
    v_status issue.status%TYPE;
    v_changed_at issue.updated_at%TYPE;
  BEGIN
    require_role(p_actor_id, 'OPERATOR');
    v_status := lock_issue(p_issue_id);
    IF p_new_status IS NULL OR NOT (
      (v_status = 'OPEN' AND p_new_status = 'IN_PROGRESS') OR
      (v_status = 'IN_PROGRESS' AND p_new_status = 'RESOLVED')
    ) THEN
      raise_application_error(-20006, 'Invalid status transition');
    END IF;
    IF length(trim(p_note)) > 500 THEN
      raise_application_error(-20003, 'Invalid status note');
    END IF;

    v_changed_at := systimestamp;
    UPDATE issue SET status = p_new_status, updated_at = v_changed_at WHERE id = p_issue_id;
    INSERT INTO issue_status_history (issue_id, actor_id, previous_status, new_status, note, created_at)
    VALUES (p_issue_id, p_actor_id, v_status, p_new_status, trim(p_note), v_changed_at);
  END;

  PROCEDURE add_confirmation(p_issue_id IN NUMBER, p_user_id IN NUMBER) IS
  BEGIN
    require_role(p_user_id, 'CITIZEN');
    IF lock_issue(p_issue_id) = 'RESOLVED' THEN
      raise_application_error(-20005, 'Resolved issues cannot be confirmed');
    END IF;

    INSERT INTO issue_confirmation (issue_id, user_id) VALUES (p_issue_id, p_user_id);
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      raise_application_error(-20004, 'Issue already confirmed');
  END;

  PROCEDURE remove_confirmation(p_issue_id IN NUMBER, p_user_id IN NUMBER) IS
    v_status issue.status%TYPE;
  BEGIN
    require_role(p_user_id, 'CITIZEN');
    v_status := lock_issue(p_issue_id);
    DELETE FROM issue_confirmation WHERE issue_id = p_issue_id AND user_id = p_user_id;
  END;

  FUNCTION calculate_priority(p_severity IN VARCHAR2, p_confirmation_count IN NUMBER)
    RETURN NUMBER DETERMINISTIC IS
    v_weight NUMBER;
  BEGIN
    v_weight := CASE p_severity WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 END;
    IF v_weight IS NULL OR p_confirmation_count IS NULL OR
       p_confirmation_count < 0 OR p_confirmation_count <> trunc(p_confirmation_count) THEN
      raise_application_error(-20003, 'Invalid priority data');
    END IF;
    RETURN v_weight * 10 + p_confirmation_count * 2;
  END;

  PROCEDURE get_community_metrics(
    p_totals OUT SYS_REFCURSOR, p_categories OUT SYS_REFCURSOR, p_neighborhoods OUT SYS_REFCURSOR
  ) IS
  BEGIN
    OPEN p_totals FOR
      SELECT count(*) AS "total",
             count(CASE WHEN status = 'OPEN' THEN 1 END) AS "open",
             count(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) AS "inProgress",
             count(CASE WHEN status = 'RESOLVED' THEN 1 END) AS "resolved"
      FROM issue;

    OPEN p_categories FOR
      SELECT c.id AS "id", c.name AS "name", count(i.id) AS "count"
      FROM issue_category c LEFT JOIN issue i ON c.id = i.category_id
      GROUP BY c.id, c.name ORDER BY count(i.id) DESC, c.name;

    OPEN p_neighborhoods FOR
      SELECT min(l.neighborhood) AS "name", count(*) AS "count"
      FROM issue i JOIN issue_location l ON l.id = i.location_id
      GROUP BY nlssort(l.neighborhood, 'NLS_SORT=BINARY_AI')
      ORDER BY count(*) DESC, min(l.neighborhood)
      FETCH FIRST 10 ROWS ONLY;
  END;
END pkg_issues;
/
