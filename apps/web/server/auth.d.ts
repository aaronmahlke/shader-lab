declare module "#auth-utils" {
  interface User {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
  }
  interface SecureSessionData {
    userId: string;
  }
}

export {};
