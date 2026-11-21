-- Fixture cho test RLS (SP023 / Task152).
--
-- Id cố định để Go đối chiếu được, và chạy lại nhiều lần không nhân đôi dữ liệu (ON CONFLICT).
-- Fixture chạy bằng role chủ (RLS_TEST_DSN), KHÔNG phải role app: đây là dữ liệu của nhiều
-- tenant do "hệ thống" ghi vào, đúng như lúc seed/khôi phục.
--
--   An   (a...) sở hữu dự án 1111...
--   Bình (b...) sở hữu dự án 2222... và có tab 4444...
--   Chi  (c...) là thành viên (viewer) của dự án của Bình
--   An thứ hai (d...) cùng tên với An nhưng không sở hữu gì: chứng minh policy so theo id,
--        không so theo tên hiển thị.

INSERT INTO users (id, display_name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'An'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Bình'),
  ('cccccccc-0000-4000-8000-000000000003', 'Chi'),
  ('dddddddd-0000-4000-8000-000000000004', 'An')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cloud_projects (id, owner_id, name, engine) VALUES
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Dự án của An', 'postgres'),
  ('22222222-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Dự án của Bình', 'mysql')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cloud_tabs (id, project_id, name, sql, position) VALUES
  ('33333333-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000001', '01_an.sql', 'SELECT 1', 0),
  ('44444444-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000002', '01_binh.sql', 'SELECT 2', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cloud_project_members (project_id, user_id, role) VALUES
  ('22222222-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003', 'viewer')
ON CONFLICT (project_id, user_id) DO NOTHING;
