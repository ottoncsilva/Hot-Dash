"use client";

import { useState } from "react";

/**
 * Campo de CHAVE, TOKEN ou SEGREDO — nasce só-leitura e libera no clique.
 *
 * É a única defesa que funciona contra o gerenciador de senhas do navegador.
 * Um `type="password"` é um campo de senha para ele, e o Chrome ignora
 * `autocomplete="off"` nesses campos: ao reabrir a tela ele preenchia sozinho,
 * com a senha do painel, e o próximo "Salvar" mandava aquilo como chave nova.
 *
 * Foi assim que o token do bot de uma modelo passou a recusar QUALQUER edição
 * com "Esse token não tem o formato de um token de bot do Telegram" — o token
 * salvo estava certo, o campo é que tinha sido preenchido pelo navegador. Em
 * toda tela de chave o estrago é o mesmo: a chave boa, guardada e funcionando,
 * é trocada por lixo sem ninguém digitar nada.
 *
 * Campo só-leitura o navegador não preenche. O clique de quem vai digitar
 * libera, e `readOnly` (ao contrário de `disabled`) não muda a aparência nem
 * impede o foco — para quem usa, nada muda.
 *
 * Vale também para a metade NÃO secreta de uma credencial (client id, api_id,
 * app id): o navegador a enxerga como o campo de usuário do par e enfia o
 * e-mail do login nela — daí `tipo="texto"`, que é o mesmo campo sem esconder
 * o que está escrito.
 *
 * Não serve para o campo de senha do LOGIN: ali o preenchimento automático é
 * justamente o que se quer.
 */
export default function CampoSecreto({
  value,
  onChange,
  placeholder,
  className = "input font-mono",
  name,
  tipo = "senha",
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Só para o navegador distinguir um campo do outro na mesma tela. */
  name?: string;
  /** "texto" mostra o que está escrito — para a metade não secreta do par. */
  tipo?: "senha" | "texto";
  /** Teclado do celular, quando a credencial é só números (ex.: `api_id`). */
  inputMode?: "numeric";
}) {
  const [liberado, setLiberado] = useState(false);
  return (
    <input
      className={className}
      type={tipo === "texto" ? "text" : "password"}
      name={name}
      inputMode={inputMode}
      // O Chrome ignora "off" em campo de senha, mas respeita este — vale como
      // segunda tranca, e cobre o gerenciador que não olha o `readOnly`.
      autoComplete="new-password"
      data-lpignore="true"
      data-1p-ignore=""
      readOnly={!liberado}
      onFocus={() => setLiberado(true)}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
