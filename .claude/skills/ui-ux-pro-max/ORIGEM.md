# Origem desta skill

Não é código do Hot-Dash. Foi copiada de um projeto de terceiros:

- Repositório: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Commit: `8bd29e7` (`8bd29e7`)
- Licença: MIT (ver LICENSE no repositório de origem)
- Copiada em: 2026-08-31

## O que foi retirado da cópia

`scripts/tests/`, `scripts/__pycache__/` e `scripts/validate_data.py` —
servem para quem DESENVOLVE a skill (rodar a suíte, validar os CSVs), não para
quem a usa. São 308 KB que não fazem falta aqui.

Só a skill `ui-ux-pro-max` foi trazida. O repositório de origem traz outras
seis (`ui-styling`, `design-system`, `brand`, `design`, `slides`,
`banner-design`); ficaram de fora — `ui-styling` sozinha são 5,8 MB de
fontes TTF, e `design-system` traz um script que baixa imagem do Pexels.

## Auditoria feita antes de instalar

Os scripts desta skill não abrem rede, não chamam subprocesso e não usam
`eval`/`exec`/`pickle`. Rodam em Python 3 puro, sem dependência, lendo os
CSV/JSON de `data/`. A única menção a URL é `urllib.parse` num validador
(que foi retirado) para separar string de endereço — não para buscar nada.

## Como atualizar

Copiar de novo do repositório de origem, refazer os cortes acima e atualizar o
commit registrado aqui. Não editar os arquivos no lugar: a próxima atualização
perderia a mudança sem avisar.

## Uma correção feita na cópia

Os comandos da `SKILL.md` vinham escritos como
`${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py`. Essa
variável só é preenchida quando a skill é instalada como PLUGIN; aqui ela é
skill de projeto, então sairia vazia e o comando apontaria para lugar nenhum —
falha silenciosa, do tipo que faz parecer que a skill "não achou nada". As 11
ocorrências viraram o caminho relativo à raiz do projeto.

Ao atualizar a cópia, refazer esta substituição.
