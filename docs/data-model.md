# Modelagem de dados

## MER conceitual

```mermaid
erDiagram
    APP_USER ||--o{ ISSUE : records
    CATEGORY ||--o{ ISSUE : classifies
    LOCATION ||--|| ISSUE : locates
    APP_USER ||--o{ CONFIRMATION : makes
    ISSUE ||--o{ CONFIRMATION : receives
    ISSUE ||--|{ STATUS_CHANGE : has
    APP_USER ||--o{ STATUS_CHANGE : records
```

Cada ocorrência tem uma categoria, um autor cidadão e uma localização própria. O par ocorrência e cidadão identifica uma confirmação. O histórico começa no registro e cresce a cada transição feita por um agente comunitário ou pelo encerramento solicitado pelo autor.

## DER físico

```mermaid
erDiagram
    APP_USER ||--o{ APP_SESSION : user_id
    APP_USER ||--o{ ISSUE : author_id
    ISSUE_CATEGORY ||--o{ ISSUE : category_id
    ISSUE_LOCATION ||--o| ISSUE : location_id
    ISSUE ||--o{ ISSUE_CONFIRMATION : issue_id
    APP_USER ||--o{ ISSUE_CONFIRMATION : user_id
    ISSUE ||--o{ ISSUE_STATUS_HISTORY : issue_id
    APP_USER ||--o{ ISSUE_STATUS_HISTORY : actor_id

    APP_USER {
        NUMBER id PK
        VARCHAR2 demo_key UK
        VARCHAR2 display_name
        VARCHAR2 email UK
        VARCHAR2 password_hash
        VARCHAR2 role
    }
    APP_SESSION {
        RAW token_hash PK
        NUMBER user_id FK
        TIMESTAMP_TZ expires_at
    }
    ISSUE_CATEGORY {
        NUMBER id PK
        VARCHAR2 code UK
        VARCHAR2 name UK
    }
    ISSUE_LOCATION {
        NUMBER id PK
        VARCHAR2 neighborhood
        VARCHAR2 address
        VARCHAR2 postal_code
        NUMBER latitude
        NUMBER longitude
    }
    ISSUE {
        NUMBER id PK
        NUMBER author_id FK
        NUMBER category_id FK
        NUMBER location_id FK, UK
        VARCHAR2 title
        VARCHAR2 description
        VARCHAR2 severity
        VARCHAR2 status
        VARCHAR2 request_key
        RAW request_hash
        BLOB photo
        VARCHAR2 photo_mime
        NUMBER is_sample
        TIMESTAMP_TZ created_at
        TIMESTAMP_TZ updated_at
    }
    ISSUE_CONFIRMATION {
        NUMBER issue_id PK, FK
        NUMBER user_id PK, FK
        TIMESTAMP_TZ created_at
    }
    ISSUE_STATUS_HISTORY {
        NUMBER id PK
        NUMBER issue_id FK
        NUMBER actor_id FK
        VARCHAR2 previous_status
        VARCHAR2 new_status
        VARCHAR2 note
        TIMESTAMP_TZ created_at
    }
    ADDRESS_SEARCH_CACHE {
        RAW query_hash PK
        VARCHAR2 result_json
        TIMESTAMP_TZ expires_at
    }
    APP_SCHEMA_MIGRATION {
        VARCHAR2 version PK
        VARCHAR2 checksum
        TIMESTAMP_TZ applied_at
    }
```

- `ISSUE` tem unicidade em `(author_id, request_key)`. A repetição com o mesmo conteúdo recupera a ocorrência existente. Com conteúdo diferente, retorna conflito.
- `ISSUE_LOCATION` mantém as coordenadas dentro dos limites geográficos. `CREATE_ISSUE` exige latitude e longitude para todas as novas ocorrências. O CEP, quando informado, é armazenado com oito dígitos. A descrição da ocorrência pode ficar vazia. A rotina cria localização, ocorrência, foto BLOB e histórico inicial na mesma transação.
- `ISSUE_CONFIRMATION` tem chave primária composta. Confirmações e mudanças de status bloqueiam a mesma linha da ocorrência antes de validar o estado. Uma ocorrência resolvida permite ao cidadão remover a própria confirmação existente.
- `PKG_ISSUES` aceita o fluxo do agente `OPEN → IN_PROGRESS → RESOLVED`. `CLOSE_ISSUE` permite exclusivamente ao autor passar de `OPEN` ou `IN_PROGRESS` para `CLOSED`, sem remover dados. Cada transição grava responsável, data e observação opcional no histórico. Encerramento é idempotente e bloqueia novas confirmações e transições de status. Os indicadores distinguem `closed` de `resolved`.
- `CALCULATE_PRIORITY` usa `10 × peso da gravidade + 2 × confirmações`. Os pesos de `LOW`, `MEDIUM` e `HIGH` são 1, 2 e 3. O total de confirmações e a pontuação são calculados nas consultas.
- As procedures não fazem `COMMIT`. A API confirma ou desfaz a transação e usa transação somente leitura para detalhes e indicadores com múltiplas consultas. Os três cursores de indicadores são fechados antes da devolução da conexão ao pool.
- `APP_SCHEMA_MIGRATION` registra versão, checksum e conclusão. Execute um migrador por vez. O runner verifica conflitos antes de iniciar cada migração e pode retomar a criação após uma interrupção. O seed insere chaves estáveis e preserva os exemplos existentes, inclusive seus históricos e confirmações.

- Contas públicas são criadas como `CITIZEN`. A moderação concede ou revoga `OPERATOR` de uma conta cadastrada. `APP_SESSION` armazena o hash do token e sua expiração. Autores históricos da demonstração preservam seus vínculos e não têm credenciais para login.

- `LOCATE_ISSUE` bloqueia a ocorrência, permite que o autor ou um agente forneça coordenadas quando o ponto ainda está vazio e mantém o endereço registrado. O backend controla a transação.
- `ADDRESS_SEARCH_CACHE` guarda as alternativas externas de uma consulta normalizada por hash, com expiração. O JSON representa uma resposta externa cacheada. As localizações confirmadas permanecem nas colunas relacionais de `ISSUE_LOCATION`.

- Os cinco registros de exemplo herdados receberam posições ilustrativas por suas chaves estáveis. Registros reais são preservados. Novos cadastros exigem coordenadas na validação compartilhada e no package PL/SQL.
- `LOCATE_ISSUE` também preenche bairro, endereço e CEP disponível quando o autor ou um agente completa uma localização antiga.
