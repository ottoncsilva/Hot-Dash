"use client";

import { TAG_COLORS } from "@/lib/types";

export default function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="grid h-7 w-7 place-items-center rounded-full border-2 transition-all"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "#fff" : "transparent",
          }}
          aria-label={c}
        />
      ))}
    </div>
  );
}
