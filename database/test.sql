DECLARE
  v_author NUMBER;
  v_citizen NUMBER;
  v_operator NUMBER;
  v_category NUMBER;
  v_id NUMBER;
  v_retry_id NUMBER;
  v_created NUMBER;
  v_key VARCHAR2(36) := lower(regexp_replace(rawtohex(sys_guid()), '(.{8})(.{4})(.{4})(.{4})(.{12})', '\1-\2-\3-\4-\5'));
  v_hash RAW(32) := hextoraw(lpad('12', 64, '0'));
  v_status issue.status%TYPE;
  v_total_before NUMBER;
  v_total NUMBER;
  v_open NUMBER;
  v_progress NUMBER;
  v_resolved_before NUMBER;
  v_resolved NUMBER;
  v_closed NUMBER;
  v_count NUMBER;
  v_category_id NUMBER;
  v_name VARCHAR2(80 CHAR);
  v_totals SYS_REFCURSOR;
  v_categories SYS_REFCURSOR;
  v_neighborhoods SYS_REFCURSOR;

  PROCEDURE assert_number(p_expected IN NUMBER, p_actual IN NUMBER, p_message IN VARCHAR2) IS
  BEGIN
    IF p_actual IS NULL OR p_expected <> p_actual THEN
      raise_application_error(-20100, p_message);
    END IF;
  END;
BEGIN
  SAVEPOINT before_tests;
  INSERT INTO app_user (display_name, role) VALUES ('Teste ana', 'CITIZEN') RETURNING id INTO v_author;
  INSERT INTO app_user (display_name, role) VALUES ('Teste bruno', 'CITIZEN') RETURNING id INTO v_citizen;
  INSERT INTO app_user (display_name, role) VALUES ('Teste operator', 'OPERATOR') RETURNING id INTO v_operator;
  SELECT id INTO v_category FROM issue_category WHERE code = 'ROADS';
  SELECT count(*), count(CASE WHEN status = 'RESOLVED' THEN 1 END)
  INTO v_total_before, v_resolved_before FROM issue;

  pkg_issues.create_issue(v_author, v_category, 'Direct Oracle test', 'Test report for the Oracle package.',
    'HIGH', 'Oracle test', 'Test location', -23.5, -46.6, v_key, v_hash, NULL, NULL, 0, v_id, v_created);
  assert_number(1, v_created, 'Expected a new issue');
  SAVEPOINT before_location;
  UPDATE issue_location SET latitude = NULL, longitude = NULL
  WHERE id = (SELECT location_id FROM issue WHERE id = v_id);
  BEGIN
    pkg_issues.locate_issue(v_id, v_citizen, -23.5, -46.6);
    raise_application_error(-20100, 'Another citizen changed the location');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20001 THEN RAISE; END IF;
  END;
  pkg_issues.locate_issue(v_id, v_author, -23.5, -46.6);
  SELECT count(*) INTO v_count FROM issue_location
  WHERE id = (SELECT location_id FROM issue WHERE id = v_id)
    AND latitude = -23.5 AND longitude = -46.6;
  assert_number(1, v_count, 'Location was not persisted');
  BEGIN
    pkg_issues.locate_issue(v_id, v_author, 0, 0);
    raise_application_error(-20100, 'An existing point was overwritten');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20007 THEN RAISE; END IF;
  END;
  ROLLBACK TO before_location;

  SELECT status INTO v_status FROM issue WHERE id = v_id;
  IF v_status <> 'OPEN' THEN raise_application_error(-20100, 'Expected open issue'); END IF;

  pkg_issues.create_issue(v_author, v_category, 'Direct Oracle test', 'Test report for the Oracle package.',
    'HIGH', 'Oracle test', 'Test location', -23.5, -46.6, v_key, v_hash, NULL, NULL, 0, v_retry_id, v_created);
  assert_number(0, v_created, 'Retry should reuse the issue');
  assert_number(v_id, v_retry_id, 'Different issue returned on retry');

  BEGIN
    pkg_issues.create_issue(v_author, v_category, 'Invalid coordinates', 'Test report with mismatched coordinates.',
      'HIGH', 'Oracle test', 'Test location', -23.5, NULL, v_key, v_hash, NULL, NULL, 0, v_retry_id, v_created);
    raise_application_error(-20100, 'Invalid coordinates were accepted');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20003 THEN RAISE; END IF;
  END;

  SAVEPOINT before_confirmation;
  pkg_issues.add_confirmation(v_id, v_citizen);
  SELECT count(*) INTO v_count FROM issue_confirmation WHERE issue_id = v_id;
  assert_number(1, v_count, 'Confirmation should be inserted');
  assert_number(32, pkg_issues.calculate_priority('HIGH', v_count), 'Incorrect priority');
  assert_number(10, pkg_issues.calculate_priority('LOW', 0), 'Incorrect low severity score');
  assert_number(24, pkg_issues.calculate_priority('MEDIUM', 2), 'Incorrect medium severity score');

  BEGIN
    INSERT INTO issue_confirmation (issue_id, user_id) VALUES (v_id, v_citizen);
    raise_application_error(-20100, 'Duplicate confirmation violated no constraint');
  EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;
  END;
  BEGIN
    pkg_issues.add_confirmation(v_id, v_citizen);
    raise_application_error(-20100, 'Duplicate confirmation procedure succeeded');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20004 THEN RAISE; END IF;
  END;

  ROLLBACK TO before_confirmation;
  SELECT count(*) INTO v_count FROM issue_confirmation WHERE issue_id = v_id;
  assert_number(0, v_count, 'Confirmation was committed inside the package');
  pkg_issues.add_confirmation(v_id, v_citizen);
  pkg_issues.remove_confirmation(v_id, v_citizen);
  SELECT count(*) INTO v_count FROM issue_confirmation WHERE issue_id = v_id;
  assert_number(0, v_count, 'Confirmation should be removed');

  BEGIN
    pkg_issues.update_issue_status(v_id, v_citizen, 'IN_PROGRESS', NULL);
    raise_application_error(-20100, 'Citizen updated the status');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20001 THEN RAISE; END IF;
  END;
  BEGIN
    pkg_issues.update_issue_status(v_id, v_operator, 'RESOLVED', NULL);
    raise_application_error(-20100, 'Status skipped a required transition');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20006 THEN RAISE; END IF;
  END;

  pkg_issues.update_issue_status(v_id, v_operator, 'IN_PROGRESS', 'Test note');
  pkg_issues.update_issue_status(v_id, v_operator, 'RESOLVED', NULL);
  SELECT count(*) INTO v_count FROM issue_status_history WHERE issue_id = v_id;
  assert_number(3, v_count, 'Status history is incomplete');
  BEGIN
    pkg_issues.add_confirmation(v_id, v_citizen);
    raise_application_error(-20100, 'Resolved issue accepted confirmation');
  EXCEPTION WHEN OTHERS THEN
    IF sqlcode <> -20005 THEN RAISE; END IF;
  END;

  pkg_issues.get_community_metrics(v_totals, v_categories, v_neighborhoods);
  FETCH v_totals INTO v_total, v_open, v_progress, v_resolved, v_closed;
  assert_number(v_total_before + 1, v_total, 'Metrics did not include the current transaction');
  assert_number(v_total, v_open + v_progress + v_resolved + v_closed, 'Status counts do not add up');
  assert_number(v_resolved_before + 1, v_resolved, 'Resolved count is incorrect');
  v_count := 0;
  LOOP
    FETCH v_categories INTO v_category_id, v_name, v_open;
    EXIT WHEN v_categories%NOTFOUND;
    v_count := v_count + v_open;
  END LOOP;
  assert_number(v_total, v_count, 'Category counts do not add up');
  FETCH v_neighborhoods INTO v_name, v_count;
  IF v_neighborhoods%NOTFOUND THEN raise_application_error(-20100, 'No neighborhood metrics'); END IF;
  CLOSE v_totals;
  CLOSE v_categories;
  CLOSE v_neighborhoods;

  ROLLBACK TO before_tests;
  SELECT count(*) INTO v_count FROM issue WHERE id = v_id;
  assert_number(0, v_count, 'Issue survived the rollback');
  SELECT count(*) INTO v_count FROM issue_status_history WHERE issue_id = v_id;
  assert_number(0, v_count, 'History survived the rollback');
END;
