export type User = { id: string; email: string; nickname: string; created_at: string };
export type LoginResult = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: User;
};
export type Session = { token: string; expiresAt: number; user: User };
