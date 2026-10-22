export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#f5c518" />
      <path d="M12 28 L15 6 H17 L20 28 Z" fill="#1f2328" />
      <path d="M16 9v4M16 16v4M16 23v3" stroke="#f5c518" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
