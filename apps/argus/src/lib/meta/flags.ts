/** Public competitor pages are read only once Meta grants Page Public Content Access to the app. */
export function publicContentApproved(): boolean {
  return process.env.META_PUBLIC_CONTENT_ACCESS === '1'
}
