"use client";

import { useEffect, useRef, useState } from "react";

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
  style,
  draggable,
  loading,
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  style?: React.CSSProperties;
  draggable?: boolean;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  // Imagem já em cache do navegador: o onLoad pode nunca disparar (o
  // navegador já marca .complete antes do React anexar o listener), o que
  // travava a miniatura invisível (opacity-0) para sempre.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  if (!src || failed) return <>{fallback ?? null}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={`${className || ""} transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      style={style}
      draggable={draggable}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
