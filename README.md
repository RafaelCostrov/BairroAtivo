# BairroAtivo

Aplicativo comunitário para registrar e acompanhar problemas de infraestrutura urbana, em apoio ao ODS 11. Moradores usam contas com e-mail e senha para registrar ocorrências. Agentes comunitários acompanham os registros e atualizam seus status.

## Execução local

Pré-requisitos: Node.js 24, Docker Desktop com o container `bairroativo-oracle` existente e Expo Go compatível com o SDK 58 ou um simulador com a versão correspondente.

```bash
docker start bairroativo-oracle
npm ci
npm run db:inspect
npm run db:migrate
npm run db:seed
npm run start:api
```

A API usa `server/.env` e escuta em `127.0.0.1:3000` por padrão. Aguarde o Oracle ficar saudável antes das migrações. O schema `BAIRROATIVO` precisa de cota no tablespace padrão. No container desta instalação, a cota é de 128 MiB no tablespace `BAIRROATIVO_DATA`, no `FREEPDB1`.

Se a API reportar `EADDRINUSE`, consulte `curl http://127.0.0.1:3000/api/v1/health`. Se a API do BairroAtivo já estiver saudável, pode usá-la. Se outro serviço precisar da porta 3000, inicie o BairroAtivo com `API_PORT=3001 npm run start:api` e defina `EXPO_PUBLIC_API_URL=http://127.0.0.1:3001/api/v1` em `mobile/.env` para o simulador iOS.

Em outro terminal, abra o Expo e pressione `i` para usar o simulador iOS.

```bash
npm run start:mobile -- --localhost
```

Para um celular na mesma rede, configure `mobile/.env` com `EXPO_PUBLIC_API_URL=http://IP_PRIVADO_DO_MAC:3000/api/v1`. Inicie a API com `API_HOST=IP_PRIVADO_DO_MAC npm run start:api` e o Expo com `npm run start:mobile -- --lan`. Use uma rede local de confiança. O emulador oficial do Android usa `10.0.2.2` para alcançar o Mac.

No iPhone, entre na mesma conta no Expo Go compatível com o SDK 58 e no terminal com `npx expo login`. Escaneie o QR Code do Expo e vá a **Registrar → Onde aconteceu? → Usar minha localização**. Autorize o acesso durante o uso e confira a latitude e a longitude antes de enviar a ocorrência.

A migração preserva os registros e os autores anteriores. Perfis antigos de demonstração ficam apenas como referências no histórico. Crie uma conta na tela inicial para registrar novas ocorrências.

O cadastro exige selecionar uma localização por **Localizar pelo endereço** ou **Usar minha localização**. As duas opções preenchem as coordenadas e os dados de endereço disponíveis. Bairro e endereço aparecem como resumo do ponto selecionado. O CEP é preenchido automaticamente quando disponível e continua editável. O app reutiliza apenas posições de até 30 segundos e precisão de até 100 metros, ou pede uma posição atual com precisão equilibrada e limite de 10 segundos. No iOS e Android, tenta primeiro a [geocodificação nativa](https://docs.expo.dev/versions/v58.0.0/sdk/location/#locationreversegeocodeasynclocation), com limite de 4 segundos. A API cruza o município com um ponto encontrado a até 500 metros das coordenadas e confere o CEP no [ViaCEP](https://viacep.com.br/) por município e UF. Dados de cidades diferentes não são combinados. Sem confirmação ou com os serviços indisponíveis, o CEP fica vazio e editável; nomes de ruas internas e condomínios podem não identificar um CEP exato. Se os serviços não encontrarem os dados, o app indica os campos indisponíveis e permite usar o ponto obtido. Respostas incompletas são tratadas sem interromper o formulário. A descrição é opcional.

O mapa inclui os pontos de todas as ocorrências que correspondem aos filtros, com carregamento em lotes de 50 pelo botão **Carregar mais no mapa**. Os detalhes de cada ocorrência também mostram o ponto em um mapa. Os cinco exemplos fictícios antigos têm pontos ilustrativos, identificados como demonstração. Em instalações anteriores com registros reais sem coordenadas, o autor ou um agente pode completar a localização pelos detalhes.

Em **Explorar**, lista e mapa ocultam ocorrências **Encerradas** por padrão. Em **Filtros → Status**, **Encerrada** mostra apenas esses registros e **Todos** inclui todos os status; **Sem encerradas** restaura a visualização padrão. **Meus registros** mantém todo o histórico do autor. A prioridade numérica aparece em cada item, tanto na ordenação por data quanto na ordenação por prioridade. Os status usam azul para abertas, amarelo para acompanhamento, verde para resolvidas e cinza para encerradas.

O botão **Filtros** permite definir as datas inicial e final de registro, em formato **DD/MM/AAAA**, com teclado numérico e barras automáticas. O filtro atualiza ao completar ou limpar uma data válida, após 300 ms; datas incompletas ou inválidas preservam o último filtro válido. As duas datas incluem o dia inteiro no fuso `America/Sao_Paulo`. Lista e mapa usam os mesmos filtros. A lista tem páginas de 15 itens, com **Anterior** e **Próxima**. A API limita cada página a 50 itens e aplica os filtros e a paginação diretamente no Oracle.

A busca de endereço consulta o [Photon](https://github.com/komoot/photon) apenas ao tocar em **Buscar endereço**. O resultado é uma aproximação e precisa ser conferido no mapa. Consultas e resultados são cacheados no Oracle por 30 dias, ou por um dia quando não há resultados. A instância local permite uma busca externa por vez, com intervalo de 1,1 segundo, e retorna até três alternativas no Brasil. O serviço público tem uso limitado e disponibilidade sem garantia. Para um volume maior, configure `GEOCODER_URL` com uma instância Photon própria ou contratada. A consulta `/locations/reverse` recebe as coordenadas e um `candidate` opcional do aparelho, confere as informações e preserva as coordenadas originais. A busca reversa privilegia o ponto mais próximo, com limite de 500 metros; ter CEP não dá preferência a um ponto distante. Resultados anteriores da busca foram invalidados pela versão do cache. Consultas de CEP são cacheadas por código, por até 30 dias, sem transmitir coordenadas ao ViaCEP.

## Contas e moderação

O cadastro público cria sempre um perfil **Morador**. O perfil **Agente comunitário** é concedido pela moderação após validar a conta. A moderação precisa de acesso autorizado ao Oracle e promove uma conta já cadastrada a partir da raiz do projeto.

```bash
npm run user:role -- conta@exemplo.com agent
```

Para revogar o papel, use `npm run user:role -- conta@exemplo.com resident`. A API consulta o papel salvo no banco em cada requisição autenticada. Agentes conduzem as etapas **Aberta → Em acompanhamento → Resolvida**. O próprio autor pode encerrar um registro aberto ou em acompanhamento pelo botão **Encerrar minha ocorrência**, nos detalhes. Após confirmar, o status passa a **Encerrada**, mantendo fotos, localização, confirmações existentes e histórico. O encerramento tem autor, data e motivo opcional, não aceita novas confirmações nem reabertura e continua visível em listas, mapas e indicadores. O cadastro e a edição do perfil aceitam apenas os campos publicados na API, e a definição de papéis fica no comando de moderação.

Senhas são armazenadas com scrypt e sal aleatório. Sessões são revogáveis e expiram em 14 dias. Use uma senha exclusiva para testes no ambiente local via HTTP. Para disponibilizar a API fora da rede de desenvolvimento, configure HTTPS.

## Estrutura

- `mobile/` contém as telas React Native, a navegação Expo Router e o cliente da API.
- `server/` contém a API Express, o pool Oracle Thin e os testes.
- `shared/` contém a validação de registros e os contratos compartilhados.
- `database/` contém as migrações, o seed e a suíte direta do package `PKG_ISSUES`.
- [docs/data-model.md](docs/data-model.md) descreve o MER, o DER e as transações.

## API

Use o prefixo `/api/v1`. As respostas JSON usam `{ data }` ou `{ error: { code, field? } }`.

| Método e rota                                                        | Uso                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                        | Disponibilidade do processo e do Oracle. Retorna `503` se o Oracle estiver indisponível.                                                                                                                         |
| `POST /auth/register`, `POST /auth/login`                            | Cadastro com `name`, `email` e `password` e login com `email` e `password`.                                                                                                                                      |
| `GET /auth/profile`, `PATCH /auth/profile`                           | Consulta do perfil ativo e alteração de `name`.                                                                                                                                                                  |
| `DELETE /auth/session`                                               | Revoga a sessão ativa.                                                                                                                                                                                           |
| `GET /categories`                                                    | Categorias disponíveis.                                                                                                                                                                                          |
| `GET /issues`                                                        | Parâmetros `search`, `category`, `status`, `order` (`recent` ou `priority`), `mine`, `startDate` e `endDate` (`AAAA-MM-DD`), `offset` e `limit` (até 50). A resposta contém `items` e `nextOffset`.              |
| `GET /issues/map`                                                    | Retorna até 50 registros com coordenadas por chamada, com `nextOffset` para continuar. Respeita `search`, `category`, `status`, `startDate` e `endDate`. Inclui uma lista limitada de registros sem coordenadas. |
| `POST /locations/reverse`                                            | Recebe `latitude` e `longitude` e retorna os dados de endereço do ponto, quando disponíveis.                                                                                                                     |
| `POST /locations/search`                                             | Recebe `query` com endereço, cidade e estado. Retorna candidatos de localização.                                                                                                                                 |
| `PATCH /issues/:id/location`                                         | Autor ou agente confirma o local com coordenadas, bairro, endereço e CEP disponível em uma ocorrência antiga sem ponto.                                                                                          |
| `GET /issues/:id`, `GET /issues/:id/photo`                           | Detalhes com histórico e foto binária, quando disponível.                                                                                                                                                        |
| `POST /issues`                                                       | Descrição e CEP opcionais. Campos em JSON ou multipart com `issue` em JSON e `photo` opcional (JPEG, PNG ou WebP, até 5 MiB). Requer `Idempotency-Key` UUID v4.                                                  |
| `POST /issues/:id/confirmations`, `DELETE /issues/:id/confirmations` | Adiciona ou remove a confirmação do cidadão ativo.                                                                                                                                                               |
| `PATCH /issues/:id/status`                                           | Recebe `status` e `note` opcional. Disponível apenas para agentes comunitários.                                                                                                                                  |
| `POST /issues/:id/close`                                             | Autor encerra uma ocorrência `OPEN` ou `IN_PROGRESS`, com `note` opcional. Retorna a ocorrência preservada em `CLOSED`. Repetir a chamada pelo autor não duplica o histórico.                                    |
| `GET /metrics`                                                       | Totais por status, por categoria e por bairro.                                                                                                                                                                   |

Perfis, ocorrências, fotos e métricas requerem `Authorization: Bearer <token>`. Login e cadastro retornam o token da sessão.

## Verificação

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run db:test
npm run test:integration
npm exec -w mobile -- expo install --check
```

Os testes de integração usam a instância real após o seed de categorias. O teste PL/SQL desfaz sua transação. A suíte HTTP remove as contas e as ocorrências criadas para o teste.
