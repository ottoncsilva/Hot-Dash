import type { SVGProps } from "react";

/**
 * Ícones de linha (estilo high-tech), desenhados à mão em SVG.
 * Sem dependências externas. Herdam a cor via currentColor.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5" />
    <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Base>
);

export const IconProfiles = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.8" />
    <path d="M17.5 20a5.2 5.2 0 0 0-3-4.7" />
  </Base>
);

export const IconMedia = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
  </Base>
);

export const IconPayments = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M2.5 9.5h19" />
    <path d="M6 15h3" />
  </Base>
);

export const IconSettings = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h10" />
    <path d="M18 6h2" />
    <circle cx="16" cy="6" r="2" />
    <path d="M4 12h2" />
    <path d="M10 12h10" />
    <circle cx="8" cy="12" r="2" />
    <path d="M4 18h10" />
    <path d="M18 18h2" />
    <circle cx="16" cy="18" r="2" />
  </Base>
);

export const IconUpload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconEdit = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.5V20z" />
    <path d="M14.5 8.5l2.8 2.8" />
  </Base>
);

export const IconEye = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Base>
);

export const IconEyeOff = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.5 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.3 3" />
    <path d="M6.2 7.4A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.2-.5" />
    <path d="M9.9 9.9a2.8 2.8 0 0 0 3.9 3.9" />
  </Base>
);

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Base>
);

export const IconLogout = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" />
    <path d="M18 15l3-3-3-3" />
    <path d="M21 12H10" />
  </Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const IconChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 5l7 7-7 7" />
  </Base>
);

export const IconArrowLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 12H4M10 6l-6 6 6 6" />
  </Base>
);

export const IconSparkle = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3c.4 4.5 1.5 5.6 6 6-4.5.4-5.6 1.5-6 6-.4-4.5-1.5-5.6-6-6 4.5-.4 5.6-1.5 6-6z" />
  </Base>
);

export const IconLock = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 14v2.5" />
  </Base>
);

export const IconLink = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 15l6-6" />
    <path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" />
    <path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" />
  </Base>
);

export const IconGrip = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </Base>
);

export const IconChevronUp = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 15l6-6 6 6" />
  </Base>
);

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);

export const IconPlay = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 5l12 7-12 7z" />
  </Base>
);
