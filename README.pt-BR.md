# ServerConsole

**Encontre uma GPU com memória livre suficiente e abra experimentos, terminal e arquivos no mesmo aplicativo.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Baixar](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## Novidades da 0.19.0

- As execuções de treinamento guardam comandos, parâmetros, códigos de saída, métricas JSONL/texto, curvas e evidências de diagnóstico. Alterne Recursos e Experimentos na página inicial; as métricas expiram após 30 dias.

- A coleta em camadas de GPU, sistema e processos está ligada ao agendador real. Valores desconhecidos, horários e lacunas são preservados. A visão geral mantém quatro indicadores GPU por linha.

- Espaços de experimento salvam servidor, diretório, GPU, tmux, logs e serviços. Busca e divisão do terminal e atalhos de arquivos preservam o contexto.

- Códigos de saída e resultados de parada refletem a execução remota. A identidade de início protege contra PID reutilizado. Desconexões chegam às regras e ao resumo móvel.

- Histórico de 30 minutos, 1 hora, 12 horas, 1 dia e 1 semana, comparação GPU, disco/rede, exportações e eventos. Dados originais expiram em 24 horas e resumos em 30 dias.

- Tarefas, logs incrementais, alertas de GPU disponível, regras, contêineres e túneis. Slurm oferece tarefas, detalhes e logs somente para leitura quando suportado pelo host.

- Revise mudanças e exclusões antes de sincronizar. O envio ao salvar distingue fila, transferência, sucesso e falha; o horário de sucesso só muda após a conclusão.

- Diagnóstico e backup de configuração sem credenciais ajudam na recuperação e migração. Webhooks HTTPS são opcionais e desativados inicialmente. Um coletor sem interface iniciado à parte mantém histórico com o aplicativo fechado.

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Primeiros passos

Escolha um pacote anexado em Releases. Windows não é assinado e pode mostrar SmartScreen. Compare SHA-256 com o arquivo da mesma versão. macOS/Linux dependem dos workflows e arquivos efetivamente publicados.

Adicione ou importe SSH, confirme a impressão digital e abra a visão geral ou área de trabalho. GPU precisa de nvidia-smi; sistema usa Linux /proc. Memória livre não é reserva.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Desenvolvimento

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

O navegador é uma demonstração simulada identificada. SSH, terminal e SFTP reais exigem Electron.

```sh
npm run electron:dev
```

React 18 · TypeScript · Electron · Vite · ssh2 · SQLite. [package.json](package.json) · [Architecture](docs/ARCHITECTURE.md)

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
```

## Validação e alcance

O registro atual contém comandos, resultados e verificações pendentes. Dois hosts Linux reais verificaram fluxo GPU, três camadas, contadores e tarefa própria com saída 7. Isso não valida frotas, transferências de 100GB, Slurm/MIG reais ou todos os instaladores.

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Idiomas e guias

Aplicativo e README em dez idiomas. Traduções assistidas precisam de revisão nativa. Saídas remotas mantêm o idioma. As imagens mostram simulações de versões antigas.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
