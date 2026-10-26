/** Where to send someone who must sign in; they come back to `next` (pathname + search) afterwards. */
export const signInPath = (next: string) => `/auth/sign-in?next=${encodeURIComponent(next)}`;
