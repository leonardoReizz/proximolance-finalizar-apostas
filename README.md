# Serviço de Finalização de Apostas

Serviço em TypeScript responsável por processar e finalizar apostas após a resolução dos mercados.

## Responsabilidades

1. **Buscar apostas pendentes** em mercados já resolvidos (status: `processing`)
2. **Validar resultados** baseado nos eventos ocorridos durante o jogo
3. **Processar pagamentos** via API externa (creditar vitórias, reembolsos, registrar perdas)
4. **Atualizar status** das apostas (`won` ou `lost`)
5. **Marcar mercados como concluídos** após processar todas as apostas

## Arquitetura

### Separação de Responsabilidades

- **Backend** (Node.js): Coleta eventos dos jogos e resolve mercados
- **Finalizar-apostas** (TypeScript): Processa apostas e finaliza pagamentos

### Fluxo de Processamento

```
1. Backend abre mercado (status: 'betting')
2. Usuários fazem apostas (status: 'pending')
3. Backend fecha mercado (status: 'game')
4. Eventos ocorrem e são registrados em logs
5. Backend finaliza mercado (status: 'processing')
6. Finalizar-apostas processa apostas pendentes
7. Mercado marcado como concluído (status: 'completed')
```

## Instalação

```bash
npm install
# ou
yarn install
```

## Configuração

1. Copie o arquivo de exemplo:
```bash
cp .env.example .env
```

2. Configure as variáveis de ambiente no arquivo `.env`:
   - Credenciais do MongoDB
   - Credenciais do Redis
   - Intervalo de processamento
   - (Opcional) URL e chave da API externa

## Uso

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
# Build
npm run build

# Start
npm start
```

## Estrutura de Arquivos

```
finalizar-apostas/
├── src/
│   ├── index.ts              # Arquivo principal com loop de processamento
│   ├── bet-processor.ts      # Lógica de processamento de apostas
│   ├── database.ts           # Conexões MongoDB e Redis
│   ├── config.ts             # Configurações do serviço
│   └── types.ts              # Definições de tipos TypeScript
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Lógica de Validação

### Tipos de Apostas

1. **Aposta em jogo específico (A ou B)**
   - Ganha se o primeiro evento do tipo ocorrer no jogo apostado
   - Reembolso se nenhum evento ocorrer em nenhum jogo
   - Perde se o primeiro evento ocorrer no jogo oposto

2. **Aposta em "none"**
   - Ganha se NENHUM evento do tipo ocorrer em nenhum jogo
   - Perde se algum evento ocorrer

3. **Aposta em "atLeastOne"**
   - Ganha se QUALQUER evento ocorrer no jogo apostado
   - Reembolso se nenhum evento ocorrer em nenhum jogo

### Cálculos

- **Vitória**: `prêmio = valor_apostado * odd`
- **Reembolso**: `reembolso = valor_apostado * (percentual_reembolso / 100)`
- **Taxa da casa**: `taxa = valor_apostado - reembolso`

## Integração com API Externa

O arquivo `bet-processor.ts` contém exemplos comentados de como integrar com uma API externa para creditar/debitar saldos.

### Exemplos de Endpoints

**Creditar saldo (vitória ou reembolso):**
```typescript
POST /users/{userId}/credit
{
  "amount": 1000,        // em centavos
  "reason": "bet_win",
  "betId": "...",
  "timestamp": "2024-..."
}
```

**Registrar perda:**
```typescript
POST /users/{userId}/record-loss
{
  "amount": 500,         // em centavos
  "reason": "bet_loss",
  "betId": "...",
  "timestamp": "2024-..."
}
```

## Logs

O serviço registra todos os eventos importantes:
- Início/fim de cada ciclo de processamento
- Apostas processadas com sucesso
- Erros durante o processamento
- Conexões com banco de dados

## Status dos Mercados

- `betting`: Mercado aberto para apostas
- `game`: Jogo em andamento, apostas fechadas
- `processing`: Mercado resolvido, aguardando finalização de apostas
- `completed`: Todas as apostas finalizadas

## Tratamento de Erros

- Erros em apostas individuais não interrompem o processamento
- Logs de erro são registrados no banco
- Conexões são fechadas gracefully ao encerrar o serviço

## Monitoramento

Recomendações para produção:
- Configure logs estruturados (Winston, Pino)
- Implemente health checks
- Configure alertas para erros críticos
- Monitore tempo de processamento de cada ciclo

## Licença

ISC
