"use client";

import { useEffect, useState } from "react";

/**
 * Imagem servida por uma rota protegida. Como a autenticação é por cookie
 * de sessão (enviado automaticamente), basta uma tag <img> comum — com
 * fallback caso a imagem não exista/carregue.
 */
export default function AuthImage({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback ?? null}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
