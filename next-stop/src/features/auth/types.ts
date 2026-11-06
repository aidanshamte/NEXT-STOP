export interface AuthOptions {
  emailEnabled: boolean;
  googleEnabled: boolean;
  googleWebClientId: string;
}
export interface AuthResult {
  token?: string;
  requiresVerification?: boolean;
  email?: string;
}
