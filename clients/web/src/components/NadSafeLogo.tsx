interface Props {
  size?: number;
  className?: string;
}

export function NadSafeLogo({ size = 32, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NadSafe"
      role="img"
      className={className}
    >
      <path
        d="M50 5 L95 20 L95 68 C95 87 50 97 50 97 C50 97 5 87 5 68 L5 20 Z"
        fill="#0f172a" stroke="#3b82f6" strokeWidth="2.5"
      />
      <path
        d="M50 13 L87 26 L87 67 C87 81 50 90 50 90 C50 90 13 81 13 67 L13 26 Z"
        fill="none" stroke="#1e3a8a" strokeWidth="1.2"
      />
      <path
        d="M33 64 L33 38 L67 64 L67 38"
        fill="none" stroke="#f59e0b" strokeWidth="8"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <rect x="22" y="64" width="56" height="27" rx="5"
        fill="#1d4ed8" stroke="#3b82f6" strokeWidth="1.5"
      />
      <circle cx="50" cy="75" r="5" fill="#bfdbfe" />
      <rect x="47" y="75" width="6" height="9" rx="3" fill="#bfdbfe" />
    </svg>
  );
}
