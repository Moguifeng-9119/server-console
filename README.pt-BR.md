# ServerConsole

**Encontre uma GPU com memória livre suficiente, veja quem a usa e abra terminal ou arquivos no mesmo aplicativo de desktop.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Baixar](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.2) · [Relatar problema](https://github.com/Moguifeng-9119/server-console/issues)

**0.12.2:** falhas remotas corretas, idioma persistente, respostas de atualização validadas e limpeza durável de chaves diretas. Dois servidores reais passaram rsync, recuperação após encerrar o processo principal e SHA-256.

**Os arquivos Windows não são assinados. O SmartScreen pode avisar. Compare o SHA-256 com o arquivo da versão.**

![Recursos GPU: dados simulados](assets/screenshots/workbench-en.png)

**Novidades da 0.12.0**

Registro persistente para recuperar e limpar arquivos temporários da tarefa; progresso SHA-256 visível e explicação de tarefas antigas. Foram adicionados controles de arquivos/retransmissão por teclado, proteção do texto não salvo e ESLint/Hooks. Os dez idiomas têm 678 chaves; falta a revisão nativa de todos os rascunhos auxiliados por tradução automática.

A 0.12.2 validou upload de 16 MiB e rsync em dois servidores Linux reais, recuperação após encerrar todo o processo principal, progresso do prefixo e limpeza exata das chaves/diretórios das tarefas. Os números 0.11.1 abaixo são históricos. Escopo atual: [0.12.2](docs/VALIDATION-0.12.2.md).

![27-second simulated workflow](assets/demo/workflow.gif)

<p><img src="assets/screenshots/relay-en.png" alt="Simulated server relay" width="49%"> <img src="assets/screenshots/transfer-en.png" alt="Simulated resume verification" width="49%"></p>

As imagens mostram a v0.12.0 com dados simulados. A v0.12.0 oferece Windows x64 portátil, AppImage Linux x86_64 e DMG universal macOS com somas SHA-256. Os pacotes não são assinados; o macOS não tem notarização.

[Detailed usage and recovery (English)](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## Funcionalidades

Uma ferramenta pessoal para servidores compartilhados **Linux / NVIDIA GPU**, via SSH sem agente de monitoramento remoto.

- Filtre GiB livres por GPU, modelo e usuário, ordene por memória disponível e abra monitoramento, terminal ou arquivos diretamente.
- Veja processos, várias GPU por PID, diferenças de contadores CPU Linux, horário de coleta e histórico com intervalos sem dados.
- Filas, retomada verificada, recuperação após reiniciar, rsync direto ou retransmissão SFTP; importação SSH config, grupos, ProxyJump, comandos e encaminhamento de portas.
- Alertas ativos/resolvidos e no máximo dois avisos dispensáveis; a demonstração não envia alertas externos.

Não inclui contas de equipe, reservas, agendamento de clusters, telemetria AMD/Intel GPU ou diagnóstico NVML completo. Memória livre não é uma reserva.

## Primeiros passos

Baixe seu pacote, teste e adicione um servidor ou importe SSH config. GPU requer nvidia-smi remoto; sistema usa Linux /proc. Para executar o código, use Node.js 22 e npm:

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

O navegador é uma simulação identificada. SSH, credenciais, terminal e SFTP reais precisam do processo de desktop:

```sh
npm run electron:dev
```

Informe os GiB livres por placa, modelo ou usuário. Configurações são agrupadas. Ctrl/Cmd+K abre a paleta; os principais diálogos aceitam Tab, Shift+Tab, Escape e restauração do foco.

## Transferências e credenciais

- Um destino arbitrário não é usado como prefixo de retomada: arquivos temporários próprios e comparação SHA-256 de todo o prefixo.
- SFTP verifica bytes e tamanho/data da origem antes de substituir, serializa destinos sobrepostos e mantém dados ao falhar. Falhas de limpeza ao cancelar/remover preservam o registro de recuperação e são informadas.
- MD5 opcional é verificado antes de substituir arquivos individuais; diretórios e retransmissões não são declarados verificados por MD5.
- Transferência direta exige rsync nas duas pontas e acesso da origem ao destino, com chave SSH temporária e impressão digital confiável; caso contrário, SFTP com arquivos de preparação. Alternativas tar/scp que sobrescreviam diretamente desativadas.
- Armazenamento seguro do sistema criptografa senhas e frases secretas. Se ausente ou Linux basic_text, novas credenciais ficam apenas na sessão e devem ser reinseridas após reiniciar. Configurações mostram o modo real; chaves privadas mantêm seus caminhos.

Tamanho/data não bloqueiam uma origem alterada em paralelo. Veja [segurança](SECURITY.md); rsync real e limpeza após falha passaram testes isolados.

## Validação

A v0.11.1 passou, em cada sistema Windows/Linux/macOS, por checagem de tipos, 84 testes de regressão, smoke SFTP, build e 22 verificações de navegador. Cada aplicação empacotada passou por 16 verificações nativas: IPC, shell SSH local, redimensionamento, encaminhamento e reinício autenticado.

Windows DPAPI foi testado de fato. macOS usa MockKeychain, sem validar Keychain real; execução em arm64, não Intel. Linux verifica credenciais de sessão sem armazenamento seguro. GPU/MIG físicas, PTY remoto completo, rsync/rede em produção, armazenamentos macOS/Linux reais, instaladores e atualizações exigem testes. O benchmark de 10/30 sessões SSH simuladas não comprova desempenho de cluster nem economia percentual.

## Desenvolvimento

React, TypeScript, Electron, Vite e ssh2; versões exatas em [package.json](package.json) e no lockfile. Verificações:

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npx playwright-core install chromium
npm run test:ui
npm run test:workflow
npm run benchmark
```

Defina SC_ELECTRON_PATH com o executável atual desempacotado e rode npm run e2e:terminal. dist:win:lite, dist:win:nsis, dist:linux e dist:mac desativam publicação automática. O [CI de pacotes](.github/workflows/package.yml) valida antes do envio. ESLint e React-Hooks estão configurados; npm run lint é executado na CI.

## Idiomas e contribuição

README em dez idiomas; a interface tem dez arquivos completos de chaves, carregados sob demanda. A revisão nativa de todos os textos continua pendente. [LOCALIZATION](docs/LOCALIZATION.md).

[Evidências](docs/VALIDATION-0.11.1.md) · [Metodologia](docs/BENCHMARKS.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Contribuir](CONTRIBUTING.md) · [Roteiro](docs/ROADMAP.md) · [Alterações](CHANGELOG.md) · [Licença MIT](LICENSE)
