BAIRROATIVO - GLOBAL SOLUTION 2 - 2026
CITIZENTECH: TECNOLOGIA CENTRADA NO CIDADÃO

1. APRESENTAÇÃO

Aplicativo comunitário para registrar, localizar, confirmar e acompanhar
problemas de infraestrutura urbana, em apoio ao ODS 11. O projeto utiliza
React Native, API Express/Node.js e Oracle com rotinas PL/SQL.

Funcionalidades principais: registro com localização e foto opcional;
exploração em lista e mapa; confirmação e prioridade; acompanhamento com
histórico; encerramento pelo autor; indicadores comunitários. Login e
cadastro são recursos de apoio e não integram essa contagem.

Os relatos ficam na plataforma comunitária. Não há encaminhamento automático
à prefeitura, emissão de protocolo oficial ou atendimento de emergência.

Documentação completa no Google Docs:
https://docs.google.com/document/d/1tNCdamd1y36k4JoZEs0UmV2XXcsfQpighUlT2Poh_gE/edit

Repositório GitHub: [INSERIR LINK DO GITHUB]

2. PRÉ-REQUISITOS

- Node.js 24 ou superior e NPM;
- Docker Desktop com suporte à imagem Oracle utilizada;
- Oracle Database Free, serviço FREEPDB1 e esquema BAIRROATIVO;
- Expo Go compatível com o SDK 58, ou simulador compatível;
- Internet para instalar pacotes, carregar mapas e consultar endereços/CEP;
- Mac e iPhone na mesma rede Wi-Fi para teste no aparelho físico.

O aplicativo e a API usam NPM workspaces. Os comandos abaixo devem ser
executados na raiz do projeto. As instruções usam shell Bash/Zsh.

3. ORACLE EM UMA INSTALAÇÃO NOVA

Se o container e o esquema já existem, pule esta seção e execute a seção 4.
A imagem validada no ambiente é:
container-registry.oracle.com/database/free:latest-lite

Referência oficial de configuração e compatibilidade:
https://container-registry.oracle.com/ords/ocr/ba/database/free

Exemplo de criação local, com volume persistente e porta limitada ao host:

docker run -d --name bairroativo-oracle \
  -p 127.0.0.1:1521:1521 \
  -e ORACLE_PWD='<DEFINIR_SENHA_ADMIN>' \
  -v bairroativo-oracle-data:/opt/oracle/oradata \
  container-registry.oracle.com/database/free:latest-lite

Substitua os marcadores por senhas próprias. Não publique senhas no GitHub.
Confira a arquitetura suportada pelo tag escolhido. Aguarde o banco ficar
saudável; a primeira inicialização pode levar alguns minutos.

docker ps --filter name=bairroativo-oracle
docker logs bairroativo-oracle

Em uma sessão administrativa SQL*Plus/SQL Developer, conectada ao Oracle
local, provisione o esquema no PDB FREEPDB1. Exemplo para um banco novo:

ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER BAIRROATIVO IDENTIFIED BY "<DEFINIR_SENHA_DO_SCHEMA>"
  DEFAULT TABLESPACE USERS QUOTA 128M ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE PROCEDURE
  TO BAIRROATIVO;

Esse exemplo não deve ser repetido para um usuário já existente. O ambiente
original utiliza o tablespace BAIRROATIVO_DATA com cota de 128 MiB; outro
tablespace com cota adequada também pode ser usado. A aplicação confere o
nome do esquema e o PDB, não exige um nome fixo para o tablespace.

4. CONFIGURAÇÃO E EXECUÇÃO

Crie os arquivos locais a partir dos modelos, sem sobrescrever configurações
já existentes:

cp server/.env.example server/.env
cp mobile/.env.example mobile/.env

Edite server/.env com os valores da sua instalação:

DB_USER=BAIRROATIVO
DB_PASSWORD=<SENHA_DO_SCHEMA>
DB_CONNECT_STRING=127.0.0.1:1521/FREEPDB1
API_HOST=127.0.0.1
API_PORT=3000
GEOCODER_URL=https://photon.komoot.io/api/

Para simulador iOS ou versão web, mobile/.env pode utilizar:

EXPO_PUBLIC_API_URL=http://127.0.0.1:3000/api/v1

Instale dependências e prepare o banco:

docker start bairroativo-oracle
npm ci
npm run db:inspect
npm run db:migrate
npm run db:seed

O seed atual insere as seis categorias. Não cria contas públicas com senha
compartilhada. Registros de demonstração existentes são preservados.
Execute um migrador por vez e não modifique migrações já aplicadas.

Terminal 1 - API:

npm run start:api

Terminal 2 - aplicativo em simulador local:

npm run start:mobile -- --localhost

No Expo, use a opção de abrir o simulador iOS. No emulador oficial Android,
use http://10.0.2.2:3000/api/v1 para alcançar o host. O endereço 127.0.0.1 no
celular físico aponta para o próprio celular, não para o computador.

5. TESTE NO IPHONE OU ANDROID FÍSICO

Descubra o IP privado atual do computador no Wi-Fi e substitua
IP_PRIVADO_DO_MAC nos exemplos. O endereço precisa pertencer à máquina.

Terminal 1:
API_HOST=IP_PRIVADO_DO_MAC npm run start:api

Terminal 2:
EXPO_PUBLIC_API_URL=http://IP_PRIVADO_DO_MAC:3000/api/v1 npm run start:mobile -- --lan

Abra o QR Code com Expo Go compatível. Se o Expo exigir autenticação, use a
mesma conta no Expo Go e no terminal (npx expo login). Autorize localização
ou câmera quando usar essas opções. Mudanças de IP ou de variáveis exigem
reiniciar o Expo e recarregar o projeto.

Use HTTP apenas no ambiente local de desenvolvimento. Para disponibilizar
o serviço fora desse ambiente, prepare HTTPS e a infraestrutura apropriada.

6. USO E REGRAS DE ACESSO

- Crie uma conta de morador na tela inicial;
- Registre categoria, título, gravidade e um ponto escolhido por endereço
  ou pela localização do aparelho; descrição e foto são opcionais;
- Confira o ponto e o CEP, especialmente em ruas internas e condomínios;
- Explore os relatos, confirme a permanência de problemas e acompanhe o
  histórico;
- Em Explorar, encerradas ficam ocultas por padrão. Filtros > Encerrada
  ou Todos permitem consultá-las. Meus registros mantém todo o histórico;
- Prioridade é exibida em cada item: 10 x peso da gravidade + 2 x confirmações.
  LOW=1, MEDIUM=2 e HIGH=3;
- O autor pode encerrar seu relato aberto ou em acompanhamento. A ocorrência
  passa a CLOSED, mantendo foto, localização, confirmações e histórico;
- Agentes conduzem OPEN > IN_PROGRESS > RESOLVED. Somente a moderação pode
  conceder esse perfil; não há seleção pública de agente no cadastro.

Com acesso autorizado ao servidor, a moderação usa:

npm run user:role -- conta@exemplo.com agent
npm run user:role -- conta@exemplo.com resident

7. JUSTIFICATIVAS TÉCNICAS

React Native e Expo: reaproveitamento da interface e acesso à câmera,
localização e mapas, com execução em Android e iOS e suporte web.

TypeScript e Zod: contratos compartilhados e validação em tempo de execução,
reduzindo divergências entre formulário, API e persistência.

Express e Node.js: API modular com rotas REST, autenticação, autorização,
validação, limites e tradução de erros.

Oracle e PL/SQL: integridade referencial e automação de registro, confirmação,
acompanhamento, encerramento e indicadores. As procedures não fazem COMMIT;
a API coordena commit/rollback e operações somente leitura.

Sessões opacas: token aleatório com expiração de 14 dias, hash SHA-256 no
banco e revogação no logout. Senhas usam scrypt e sal aleatório. O token é
guardado em SecureStore no nativo e sessionStorage na web.

Eficiência: lista de 15 itens por página, limite de 50 por chamada, mapas
em lotes de 50, FlatList, cache, cancelamento HTTP, redução de imagens,
liberação de objetos de imagem, pool de 1 a 6 conexões e fechamento de
cursores em finally.

Localização: geocodificação nativa e Photon, com candidatos reversos a até
500 metros; CEP conferido por município/UF no ViaCEP. Sem confirmação, o CEP
fica vazio e editável. Não é garantido um CEP exato para uma via interna.

Não há IA na versão atual. A pontuação de prioridade é determinística.

8. ORGANIZAÇÃO DO CÓDIGO E DOS MODELOS

mobile/                     Aplicativo React Native e navegação
server/src/                 API, autenticação, consultas e integrações
server/test/                Testes unitários e de integração
shared/                     Tipos, validações e utilitários compartilhados
database/migrations/        Scripts 001 a 008 e package PKG_ISSUES
database/test.sql           Suíte direta PL/SQL
database/seed.sql           Categorias iniciais
docs/data-model.md          MER, DER e regras transacionais
docs/validacao-sp.md         Doze cenários fictícios em endereços reais
docs/entrega/               Documentação completa e diagramas
ENTREGA_GITHUB.txt          Campo para inserir o link de entrega

9. VERIFICAÇÃO

npm test
npm run test:integration
npm run db:test
npm run typecheck
npm run lint
npm run format:check
npm exec -w mobile -- expo install --check

Os testes HTTP e PL/SQL exigem Oracle disponível e migrações aplicadas.
A suíte HTTP cria e remove dados isolados. O teste direto PL/SQL desfaz a
transação. Foram validados 14 testes unitários, 14 cenários HTTP e uma suíte
PL/SQL; o executor HTTP reporta 15 ao incluir o teste agregador.

10. PROBLEMAS COMUNS

EADDRINUSE: a porta já está ocupada. Confira se a API já responde em
http://127.0.0.1:3000/api/v1/health (ou no IP de API_HOST). Reutilize a
instância correta ou pare seu processo antes de iniciar outra. Para usar
outra porta, ajuste API_PORT e EXPO_PUBLIC_API_URL em conjunto.

EADDRNOTAVAIL: API_HOST não está atribuído à máquina. Confira o IP atual do
Wi-Fi; não use um endereço antigo ou o IP de outro equipamento.

Banco indisponível: confira Docker, saúde do Oracle, serviço FREEPDB1,
credenciais e cota do esquema. O endpoint /health retorna 503 se o banco
estiver indisponível.

Migração ausente ou package inválido: execute db:migrate, sem alterar o
checksum de scripts já aplicados. A versão exige a migração 008.

Localização/CEP indisponível: confira permissão do aparelho e internet;
escolha um endereço ou informe manualmente o CEP conhecido. O app preserva
as coordenadas obtidas e não deve sugerir CEP de outro município.

11. ENTREGA E LIMITAÇÕES

O repositório ainda será criado pela equipe. Preencha ENTREGA_GITHUB.txt e
o campo correspondente na documentação, envie código, README e modelos e
conceda acesso ao tutor. Arquivos .env reais, senhas, tokens e dados pessoais
não devem ser incluídos.

Os vídeos e a apresentação serão preparados em etapa posterior. Esta entrega
de documentação não informa links de vídeos que ainda não foram produzidos.

O ambiente validado é local/acadêmico. Operação pública, integração oficial,
sincronização offline, recuperação de senha, testes de carga e avaliação
completa de acessibilidade ainda são evoluções. A validação do uso no
simulador iOS e a exportação dos bundles não substituem testes completos em
aparelhos reais de todas as plataformas.
