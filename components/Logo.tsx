export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="12" cy="16" r="9" fill="#E4572E" opacity="0.85" />
      <circle cx="20" cy="16" r="9" fill="#2E86AB" opacity="0.85" />
      <path d="M16 7.94A9 9 0 0 1 16 24.06A9 9 0 0 1 16 7.94Z" fill="currentColor" />
    </svg>
  );
}
