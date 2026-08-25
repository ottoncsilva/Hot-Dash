"use client";

import { useEffect, useRef } from "react";

/**
 * Campo de valor em dinheiro — digita "de trás pra frente", tipo
 * calculadora/maquininha de cartão: cada dígito empurra os anteriores pra
 * esquerda e preenche antes e depois da vírgula sozinho. Resolve o problema
 * de digitar no celular num campo de texto comum com máscara: lá o cursor
 * nasce no meio/início do valor formatado, e digitar exige primeiro MOVER o
 * dedo até o fim do campo. Aqui o cursor é sempre forçado pro fim — não tem
 * onde posicionar errado.
 *
 * Por fora continua um campo de string comum (`value`/`onChange` como
 * "34.90", com PONTO decimal — o mesmo formato que os campos de preço já
 * usam), pra não precisar mudar quem já lê/salva esses valores — só a
 * EDIÇÃO muda de comportamento. Mostra a cifra (R$/US$) fixa, fora da parte
 * editável.
 */
export type MoneyCurrency = "BRL" | "USD" | "GBP" | "MXN" | "EUR";

/** Cifra mostrada fixa no campo, e o locale só decide separador de milhar/
 *  decimal na exibição (a matemática do dígito-a-dígito não muda com moeda
 *  nenhuma). */
const CIFRA: Record<MoneyCurrency, string> = {
  BRL: "R$",
  USD: "US$",
  GBP: "£",
  MXN: "MX$",
  EUR: "€",
};
const LOCALE: Record<MoneyCurrency, string> = {
  BRL: "pt-BR",
  USD: "en-US",
  GBP: "en-GB",
  MXN: "es-MX",
  EUR: "de-DE",
};

export function MoneyInput({
  value,
  onChange,
  currency = "BRL",
  className = "",
  placeholder,
  autoFocus,
  title,
}: {
  /** "34.90" (ponto decimal) ou "" — mesmo formato já usado nos campos de preço. */
  value: string;
  onChange: (v: string) => void;
  currency?: MoneyCurrency;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  title?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cifra = CIFRA[currency];
  const locale = LOCALE[currency];

  const centavos = value.trim() ? Math.round((parseFloat(value.replace(",", ".")) || 0) * 100) : 0;
  const formatted =
    centavos > 0 || value.trim()
      ? (Math.max(0, centavos) / 100).toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // O cursor fica sempre no fim (ver useEffect abaixo), então editar
    // (digitar OU apagar) só mexe no ÚLTIMO caractere — o valor bruto que
    // sobra ao tirar tudo que não é dígito JÁ é o novo buffer certo, sem
    // precisar comparar com o valor anterior.
    const digitos = e.target.value.replace(/\D/g, "").slice(-9); // teto: 9.999.999,99
    onChange(digitos ? (parseInt(digitos, 10) / 100).toFixed(2) : "");
  }

  function fimDoCampo(el: HTMLInputElement) {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }

  // Toda vez que o valor muda (inclusive por um digitar/apagar), garante que
  // o cursor esteja no fim — é isso que faz o próximo toque continuar
  // "empurrando da direita pra esquerda" em vez de cair no meio do texto.
  useEffect(() => {
    const el = inputRef.current;
    if (el && document.activeElement === el) fimDoCampo(el);
  });

  return (
    <div className={`input flex items-center gap-1.5 ${className}`} title={title}>
      <span className="shrink-0 font-mono text-xs text-zinc-500">{cifra}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoFocus={autoFocus}
        className="w-full min-w-0 bg-transparent outline-none"
        value={formatted}
        placeholder={placeholder ?? "0,00"}
        onChange={handleChange}
        onFocus={(e) => fimDoCampo(e.currentTarget)}
        onClick={(e) => fimDoCampo(e.currentTarget)}
      />
    </div>
  );
}
