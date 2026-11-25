# II ∞ — protótipo clicável (Sprint 4)

Protótipo para as entrevistas de segunda ronda. Dados fictícios, sem backend.
Tudo avança a clique — não há relógio nem temporizadores, por isso a demo
nunca "foge" enquanto o entrevistado interrompe.

## Correr

```bash
npm install
npm run dev      # http://localhost:5173
```

Verificar a contabilidade da cascata (não precisa de browser):

```bash
node verify-demo.mjs
```

---

## O que o protótipo mostra

Sete cenários, nos separadores em cima. Os primeiros quatro são o conceito
original (Sprint 4, semana 1). Os últimos três (2026-08-17) trazem para o
protótipo clicável o que entretanto ficou a funcionar de verdade no
`working-prototype/` — não são cliques em SIM/NÃO/1-2-3, são a conversa real
que o agente já tem.

| # | Cenário | O que prova |
|---|---------|-------------|
| 1 | **Vagas canceladas** | A vaga que abre é trabalhada até se preencher — a cunha |
| 2 | **Exame por marcar** | O intervalo entre consulta e exame passa a ter dono |
| 3 | **Cirurgia adiada** | O intervalo mais caro e mais silencioso |
| 4 | **Falta sem aviso** | Substitui a chamada difícil que ninguém faz |
| 5 | **Reagendamento por conversa** | O paciente escreve normalmente; o sistema pergunta antes de oferecer e respeita o médico pedido (continuidade de cuidado) |
| 6 | **Pedido de cancelamento** | Nunca cancela à primeira — sugere remarcar antes de aceitar perder o paciente |
| 7 | **Pergunta clínica** | "Na dúvida, escala": a IA nunca arrisca uma resposta clínica, encaminha para uma pessoa |

O ecrã está dividido: **agenda da clínica à esquerda, telemóvel do paciente à
direita**. Quando o sistema fala com alguém, a conversa aparece no telemóvel —
o entrevistado vê causa e efeito ao mesmo tempo.

---

## Guião da demo (cenário 1, ~4 minutos)

Botão azul grande = próximo passo. Segue sempre a mesma ordem.

**1. "Esta é a agenda de quinta-feira. Tudo confirmado, dia normal."**
→ clicar *Enviar confirmações de véspera (18:30)*

> A receção não ligou a ninguém. As mensagens saíram sozinhas às 18:30.

**2. "Às 21:15, a Rita responde."**
→ clicar *Rita cancela às 21:15*

> Repara: são 21:15. A clínica está fechada. Hoje, isto só se descobre
> de manhã — ou nem isso, se ela não avisar.

**3. "Manhã seguinte. O que é que a tua clínica faz agora com esta vaga?"**

⚠️ **Pára aqui. Faz a pergunta e cala-te.** É o momento mais valioso da
entrevista — a resposta diz-te se a dor existe. Só depois:

→ clicar *Manhã seguinte — oferecer a vaga*

**4. O Paulo (18:00) recebe a oferta. Responde no telemóvel:**
→ clicar *Responder SIM*

> Aqui está a parte honesta: olha para a agenda à esquerda. A vaga das
> 17:00 ficou preenchida, mas abriu uma nova às 18:00 — onde estava o
> Paulo. O buraco só mudou de sítio. A clínica ainda não ganhou nada.

**Esta é a jogada mais forte da demo.** Não escondas — aponta para a
agenda: continua a haver uma vaga aberta, só que mudou de hora. Mostra
que o sistema não se engana a si próprio.

**5. → clicar *Continuar — falta preencher as 18:00***

A Célia estava marcada para 26 de agosto. Aceita.

> Agora sim: aponta para a etiqueta "← veio de 26 ago" na vaga das
> 18:00. Esta consulta não existia hoje. É a Célia, sentada numa vaga
> que ia ficar vazia — vista 13 dias mais cedo.

**6. Apontar para a agenda inteira, já sem vagas abertas.**

> Este resultado não existe em lado nenhum hoje. Não é um dashboard que
> alguém tem de ir abrir — sai de graça de a agenda fazer o trabalho.

---

### Variantes para quando perguntarem "e se...?"

O protótipo aguenta as três perguntas mais prováveis:

- **"E se ninguém aceitar?"** → *Recomeçar*, e responde NÃO a todos.
  O sistema desiste 2h antes **e regista que a vaga se perdeu**. Perder
  também conta — é isso que torna o número credível.
- **"E se o Paulo não responder?"** → não-resposta trata-se como "vou na mesma";
  a vaga passa ao seguinte. (Regra explicada, não implementada no protótipo.)
- **"E se a Célia não quiser vir mais cedo?"** → responde NÃO por ela; passa
  à lista de espera.

---

## Perguntas a fazer com o protótipo à frente

Não são perguntas de validação de UI — são de modelo de negócio.

1. Quantas vagas destas achas que tiveste no mês passado? *(quase de certeza: "não sei")*
2. Se este número aparecesse todos os meses, quem é que na clínica olharia para ele?
3. Quem é que decide comprar uma coisa destas — tu, o teu sócio, a direção clínica?
4. Quanto vale uma vaga recuperada para vocês? *(caminho para o modelo de preço)*
5. Isto substitui trabalho de alguém ou acrescenta? *(risco: sabotagem pela receção)*

---

## Onde mexer

| Ficheiro | O que lá está |
|---|---|
| `src/data.ts` | Pacientes, agenda, ordem da cascata |
| `src/messages.ts` | **Todo o texto das mensagens** — mexe aqui para afinar o tom |
| `src/App.tsx` | Máquina de estados da demo |
| `verify-demo.mjs` | Verifica que a contabilidade não mente |

O tom das mensagens está deliberadamente humano: trata por tu/você sem
"Exmo. Sr.", explica porquê, e nunca culpa o paciente por faltar. Se um
entrevistado disser que soa mal, muda em `messages.ts` **durante a entrevista**
— é o tipo de feedback mais barato de incorporar.

---

## O que **não** está aqui (dizer sempre)

Não é um sistema a funcionar. É um protótipo de conversa.

- Sem backend, sem base de dados, sem SMS reais
- Sem integração com o IMED (~70% do mercado, API fechada) — o obstáculo real
- Sem RGPD/consentimento — por resolver antes de qualquer piloto
- Números (€65/consulta, minutos poupados) são **ilustrativos**, não medidos

Não deixes o entrevistado sair a pensar que isto já existe.
