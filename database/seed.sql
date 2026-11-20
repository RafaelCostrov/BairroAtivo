BEGIN
  MERGE INTO issue_category target USING (
    SELECT 'ROADS' code, 'Vias públicas' name FROM dual UNION ALL
    SELECT 'LIGHTING', 'Iluminação pública' FROM dual UNION ALL
    SELECT 'SIDEWALKS', 'Calçadas e acessibilidade' FROM dual UNION ALL
    SELECT 'WASTE', 'Resíduos e limpeza' FROM dual UNION ALL
    SELECT 'DRAINAGE', 'Drenagem' FROM dual UNION ALL
    SELECT 'PUBLIC_EQUIPMENT', 'Equipamentos públicos' FROM dual
  ) source ON (target.code = source.code)
  WHEN NOT MATCHED THEN INSERT (code, name) VALUES (source.code, source.name);
END;
