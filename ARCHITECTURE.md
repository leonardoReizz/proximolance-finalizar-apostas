# Arquitetura do Sistema de Apostas

## Visão Geral

Este documento descreve a arquitetura separada entre o **Backend** (Node.js) e o **Finalizar-Apostas** (TypeScript).

## Diagrama de Fluxo

```
┌─────────────────────────────────────────────────────────────────┐
│                          BACKEND (Node.js)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. MarketManager abre mercado                                  │
│     └─> Status: 'betting'                                       │
│     └─> BetsService.openMarket()                               │
│                                                                  │
│  2. Usuários fazem apostas                                      │
│     └─> POST /api/bets/place                                   │
│     └─> BetsService.placeBet() → MongoDB (status: 'pending')  │
│                                                                  │
│  3. MarketManager fecha mercado                                │
│     └─> Status: 'game'                                         │
│     └─> BetsService.closeMarket()                             │
│                                                                  │
│  4. EventValidator coleta eventos                              │
│     └─> Redis Subscriber escuta canais dos jogos              │
│     └─> Eventos salvos em bet_logs collection                 │
│     └─> Eventos publicados em tempo real via Socket.IO        │
│                                                                  │
│  5. MarketManager finaliza jogo                                │
│     └─> Status: 'processing'                                   │
│     └─> BetsService.endGame()                                 │
│     └─> EventValidator.finalizeBets() → apenas limpa eventos  │
│                                                                  │
│  6. MarketManager processa resultados                          │
│     └─> BetsService.processMarket(results)                    │
│     └─> Salva resultados no mercado                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    Mercado resolvido, mas
                  apostas ainda estão 'pending'
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   FINALIZAR-APOSTAS (TypeScript)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Loop a cada 5 segundos (configurável):                        │
│                                                                  │
│  1. BetProcessor.findPendingBets()                             │
│     └─> Busca mercados com status: 'processing'               │
│     └─> Busca apostas com status: 'pending' desses mercados   │
│                                                                  │
│  2. BetProcessor.getMarketEvents(marketId)                     │
│     └─> Busca eventos em bet_logs collection                  │
│     └─> Reconstrói histórico de eventos do mercado            │
│                                                                  │
│  3. BetProcessor.processBetResult(bet, events)                 │
│     └─> Aplica lógica de validação:                           │
│         • Aposta em jogo específico (A/B)                      │
│         • Aposta em "none" (nenhum evento)                     │
│         • Aposta em "atLeastOne" (pelo menos um evento)       │
│     └─> Retorna: {status, winAmount, refundAmount, reason}    │
│                                                                  │
│  4. BetProcessor.updateBetStatus(result)                       │
│     └─> Atualiza aposta no MongoDB                            │
│     └─> Status: 'won' ou 'lost'                               │
│     └─> Adiciona payout/refund/resultReason                   │
│                                                                  │
│  5. BetProcessor.processPayments(bet, result)                  │
│     ┌────────────────────────────────────────┐                │
│     │  SE VITÓRIA (won && winAmount > 0):    │                │
│     │  └─> Creditar prêmio via API externa   │                │
│     │                                         │                │
│     │  SE REEMBOLSO (refundAmount > 0):      │                │
│     │  └─> Creditar reembolso via API externa│                │
│     │  └─> Registrar taxa como perda         │                │
│     │                                         │                │
│     │  SE DERROTA (sem win/refund):          │                │
│     │  └─> Registrar perda via API externa   │                │
│     └────────────────────────────────────────┘                │
│                                                                  │
│  6. BetProcessor.addBetLog()                                   │
│     └─> Registra logs de processamento                        │
│                                                                  │
│  7. BetProcessor.completeMarket(marketId)                      │
│     └─> Calcula totalPayout                                   │
│     └─> Atualiza mercado para status: 'completed'            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Estrutura do Banco de Dados

### Collection: `markets`

```typescript
{
  _id: ObjectId,
  marketId: "market_20241217_143025_123",
  status: "betting" | "game" | "processing" | "completed",
  openedAt: Date,
  closedAt: Date | null,
  gameStartedAt: Date | null,
  gameEndedAt: Date | null,
  processedAt: Date | null,
  completedAt: Date | null,
  totalBets: number,
  totalAmount: number,
  totalPayout: number | null,
  results: {
    events: [...],
    summary: {...}
  } | null
}
```

### Collection: `bets`

```typescript
{
  _id: ObjectId,
  betId: "string",
  userId: "string",
  gameId: "sr:sport_event:12345",
  gameName: "Team A vs Team B",
  marketId: "market_20241217_143025_123",
  eventType: "side" | "corner" | "foul" | "goal" | "atLeastOne",
  selectedSide: "A" | "B" | "none",
  amount: 1000,  // em centavos
  odd: 1.85,
  potentialWin: 1850,
  status: "pending" | "won" | "lost",
  payout: number | null,
  refund: number | null,
  resultReason: string | null,
  eventsCount: number,
  createdAt: Date,
  updatedAt: Date,
  processedAt: Date | null
}
```

### Collection: `bet_logs`

```typescript
{
  betId: "string",
  type: "bet_placed" | "event_occurred" | "bet_result" | "balance_credited" | "loss_recorded",
  timestamp: "ISO String",
  data: {
    // Conteúdo varia por tipo de log
  },
  createdAt: Date
}
```

## Status dos Mercados

| Status | Descrição | Quem gerencia |
|--------|-----------|---------------|
| `betting` | Mercado aberto para apostas | Backend |
| `game` | Jogo em andamento, apostas fechadas | Backend |
| `processing` | Mercado resolvido, aguardando finalização | Backend |
| `completed` | Todas apostas finalizadas | Finalizar-Apostas |

## Status das Apostas

| Status | Descrição | Quem gerencia |
|--------|-----------|---------------|
| `pending` | Aguardando resultado | Backend cria |
| `won` | Aposta vencedora | Finalizar-Apostas |
| `lost` | Aposta perdedora | Finalizar-Apostas |

## Integração com API Externa

### Endpoint: Creditar Saldo (Vitória/Reembolso)

```http
POST /users/{userId}/credit
Content-Type: application/json
Authorization: Bearer {API_KEY}

{
  "amount": 1850,           // em centavos
  "reason": "bet_win",      // ou "bet_refund"
  "betId": "...",
  "timestamp": "2024-12-17T14:30:25.123Z"
}
```

### Endpoint: Registrar Perda

```http
POST /users/{userId}/record-loss
Content-Type: application/json
Authorization: Bearer {API_KEY}

{
  "amount": 1000,           // em centavos
  "reason": "bet_loss",     // ou "refund_fee"
  "betId": "...",
  "timestamp": "2024-12-17T14:30:25.123Z"
}
```

## Lógica de Validação Detalhada

### 1. Aposta em Jogo Específico (A ou B)

**Regra**: Qual jogo terá o evento PRIMEIRO?

```typescript
Eventos encontrados: [
  {gameId: "game_A", type: "goal", timestamp: "14:05:30"},
  {gameId: "game_B", type: "goal", timestamp: "14:07:15"}
]

Aposta: gameId="game_A", eventType="goal", amount=1000, odd=1.85

Resultado:
→ Primeiro goal foi em game_A às 14:05:30
→ Status: WON
→ Payout: 1000 * 1.85 = 1850 centavos
```

### 2. Aposta em "none"

**Regra**: NÃO deve haver o evento em NENHUM jogo

```typescript
Eventos encontrados: []

Aposta: eventType="goal", selectedSide="none", amount=500, odd=2.0

Resultado:
→ Nenhum goal em nenhum jogo
→ Status: WON
→ Payout: 500 * 2.0 = 1000 centavos
```

### 3. Aposta em "atLeastOne"

**Regra**: Deve haver QUALQUER evento no jogo apostado

```typescript
Eventos encontrados: [
  {gameId: "game_A", type: "side", timestamp: "14:02:00"},
  {gameId: "game_A", type: "corner", timestamp: "14:08:30"}
]

Aposta: gameId="game_A", eventType="atLeastOne", amount=2000, odd=1.5

Resultado:
→ 2 eventos ocorreram em game_A
→ Status: WON
→ Payout: 2000 * 1.5 = 3000 centavos
```

### 4. Reembolso (95%)

**Regra**: Nenhum evento do tipo ocorreu em nenhum jogo

```typescript
Eventos encontrados: []  // Nenhum corner em nenhum jogo

Aposta: gameId="game_B", eventType="corner", amount=1000, odd=1.75

Resultado:
→ Nenhum corner em nenhum jogo
→ Status: LOST (mas com reembolso)
→ Refund: 1000 * 0.95 = 950 centavos
→ Taxa da casa: 1000 - 950 = 50 centavos
```

## Variáveis de Ambiente

```bash
# MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=bets

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

# Processamento
PROCESS_INTERVAL_MS=5000  # 5 segundos

# API Externa
EXTERNAL_API_URL=https://api.example.com
EXTERNAL_API_KEY=your_api_key_here
```

## Comandos Úteis

### Backend
```bash
cd backend
npm start
```

### Finalizar-Apostas
```bash
cd finalizar-apostas

# Desenvolvimento (com auto-reload)
npm run dev

# Produção
npm run build
npm start
```

## Segurança e Considerações

1. **Idempotência**: O serviço só processa apostas com status `pending`
2. **Transações**: Considere usar transações MongoDB para operações críticas
3. **Retry Logic**: Implemente retry para chamadas de API externa
4. **Dead Letter Queue**: Para apostas que falharem após N tentativas
5. **Monitoramento**: Configure alertas para apostas travadas em `pending`
6. **Backup**: Faça backup dos logs antes de processamento em produção
