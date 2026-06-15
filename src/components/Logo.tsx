interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = '', size = 40 }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/phases-logo.png"
        alt="Phases"
        width={size}
        height={size}
        className="object-contain"
      />
      <span className="font-semibold text-indigo-600 text-lg tracking-tight">
        Phases
      </span>
    </div>
  );
}
