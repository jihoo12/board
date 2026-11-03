-- 초대 목록(ALLOWED_USERS)에서 `github:<아이디>` 로 사람을 지정할 수 있도록 provider 쪽 로그인 이름을 저장
ALTER TABLE users ADD COLUMN login TEXT;
