"use client";

import { useEffect, useRef, useState } from "react";
import AuthImage from "@/components/AuthImage";
import { mediaFileUrl, type MediaItem } from "@/lib/types";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_THRESHOLD = 70;
const WHEEL_SWIPE_THRESHOLD = 60;

type PointerInfo = { x: number; y: number };
type GestureMode = "none" | "pan" | "swipe" | "pinch";

/**
 * Área de exibição de UMA foto no visualizador: zoom por pinça (touch), roda
 * do mouse ou duplo toque/clique, com pan (arrastar) quando ampliada.
 * Quando não ampliada, o arraste horizontal navega para a foto anterior/
 * seguinte com o conteúdo seguindo o dedo/mouse em tempo real e um snap
 * suave ao soltar — em vez do corte seco (sem feedback visual) de antes.
 * Também aceita o gesto horizontal do trackpad (wheel deltaX), com debounce
 * para não pular várias fotos num único gesto contínuo.
 *
 * Vídeos não passam por aqui: mantêm os controles nativos intactos (ver
 * MediaViewer), já que interceptar gestos sobre eles quebraria o scrub da
 * barra de progresso.
 */
export default function MediaStage({
  item,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  item: MediaItem;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragX, setDragX] = useState(0);
  const [animate, setAnimate] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerInfo>());
  const gestureMode = useRef<GestureMode>("none");
  const pinchStart = useRef({ dist: 0, scale: 1 });
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const lastTapRef = useRef(0);
  const wheelAcc = useRef(0);
  const wheelCooldown = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado "atual" acessível de dentro do listener nativo de wheel (evita
  // closures obsoletas sem precisar reinscrever o listener a cada render).
  const latest = useRef({ scale, hasPrev, hasNext, onPrev, onNext });
  latest.current = { scale, hasPrev, hasNext, onPrev, onNext };

  // Reseta zoom/posição ao trocar de foto.
  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
    setDragX(0);
    gestureMode.current = "none";
    pointers.current.clear();
  }, [item.id]);

  // O onWheel sintético do React é passivo por padrão — preventDefault()
  // nele é ignorado (e loga aviso no console). Por isso o listener de wheel
  // é anexado nativamente com passive:false, garantindo que o zoom/gesto
  // horizontal realmente bloqueie o comportamento padrão do navegador.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      const { scale: s, hasPrev: hp, hasNext: hn, onPrev: prev, onNext: next } = latest.current;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);

      // Gesto horizontal do trackpad: navega (com debounce por gesto).
      if (absX > absY && s <= 1) {
        e.preventDefault();
        if (wheelCooldown.current) return;
        wheelAcc.current += e.deltaX;
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => (wheelAcc.current = 0), 150);
        if (Math.abs(wheelAcc.current) > WHEEL_SWIPE_THRESHOLD) {
          const goingPrev = wheelAcc.current > 0;
          wheelAcc.current = 0;
          wheelCooldown.current = true;
          setAnimate(true);
          if (goingPrev && hp) prev();
          else if (!goingPrev && hn) next();
          window.setTimeout(() => setAnimate(false), 220);
          window.setTimeout(() => (wheelCooldown.current = false), 380);
        }
        return;
      }

      // Roda do mouse: zoom.
      e.preventDefault();
      const nextScale = clampScale(s - e.deltaY * 0.0018);
      if (nextScale <= 1.02) {
        setScale(1);
        setPos({ x: 0, y: 0 });
      } else {
        setScale(nextScale);
      }
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clampScale(s: number) {
    return Math.min(MAX_SCALE, Math.max(1, s));
  }

  function clampPos(x: number, y: number, s: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    const maxX = rect ? ((s - 1) * rect.width) / 2 : 0;
    const maxY = rect ? ((s - 1) * rect.height) / 2 : 0;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  function pointerDistance() {
    const pts = Array.from(pointers.current.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function resolveSwipe(dx: number) {
    setAnimate(true);
    if (dx > SWIPE_THRESHOLD && hasPrev) onPrev();
    else if (dx < -SWIPE_THRESHOLD && hasNext) onNext();
    setDragX(0);
    window.setTimeout(() => setAnimate(false), 220);
  }

  function toggleZoom() {
    setAnimate(true);
    if (scale > 1) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    } else {
      setScale(DOUBLE_TAP_SCALE);
    }
    window.setTimeout(() => setAnimate(false), 220);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimate(false);

    if (pointers.current.size === 2) {
      gestureMode.current = "pinch";
      pinchStart.current = { dist: pointerDistance(), scale };
      return;
    }
    if (pointers.current.size === 1) {
      gestureMode.current = scale > 1 ? "pan" : "swipe";
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gestureMode.current === "pinch" && pointers.current.size === 2) {
      const dist = pointerDistance();
      if (pinchStart.current.dist > 0) {
        setScale(clampScale(pinchStart.current.scale * (dist / pinchStart.current.dist)));
      }
      return;
    }
    if (gestureMode.current === "pan") {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const next = clampPos(dragStart.current.posX + dx, dragStart.current.posY + dy, scale);
      setPos(next);
      return;
    }
    if (gestureMode.current === "swipe") {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      // Gesto predominantemente vertical: não é swipe (evita capturar um
      // arraste vertical acidental como troca de foto).
      if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dx) < 15) return;
      setDragX(dx);
    }
  }

  function endGesture(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const mode = gestureMode.current;
    if (pointers.current.size === 0) {
      if (mode === "swipe") resolveSwipe(dragX);
      if (mode === "pinch" && scale <= 1.03) {
        setAnimate(true);
        setScale(1);
        setPos({ x: 0, y: 0 });
        window.setTimeout(() => setAnimate(false), 220);
      }
      gestureMode.current = "none";
    } else {
      // Sobrou um dedo depois de um pinch: encerra o gesto em vez de saltar.
      gestureMode.current = "none";
    }
  }

  // dblclick não é confiável em touch — detecta duplo toque manualmente.
  function onPointerUp(e: React.PointerEvent) {
    if (e.pointerType === "touch" && pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 280) toggleZoom();
      lastTapRef.current = now;
    }
    endGesture(e);
  }

  const zoomed = scale > 1;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endGesture}
      onDoubleClick={toggleZoom}
      style={{ cursor: zoomed ? "grab" : "default" }}
    >
      <AuthImage
        key={item.id}
        src={mediaFileUrl(item)}
        alt={item.filename}
        draggable={false}
        className="max-h-[60vh] max-w-full object-contain"
        style={{
          transform: `translate(${pos.x + dragX}px, ${pos.y}px) scale(${scale})`,
          transition: animate ? "transform 220ms ease-out" : "none",
          willChange: "transform",
        }}
      />
      {zoomed && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
          {scale.toFixed(1)}×
        </span>
      )}
    </div>
  );
}
