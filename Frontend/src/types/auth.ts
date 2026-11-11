/** BE `User` (`/auth/login`, `/auth/register`, `/me`). */
export type User = {
  id: string;
  email: string;
  nickname: string;
  created_at: string;
};

/** 로그인 결과. `expires_at`은 앱이 `expires_in`(초)으로 계산해 둔 만료 시각(ms). */
export type Session = {
  token: string;
  user: User;
  expires_at: number;
};
