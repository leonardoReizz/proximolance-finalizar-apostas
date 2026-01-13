/**
 * Tipos do sistema de finalização de apostas
 */

export interface Bet {
  _id: string;
  betId: string;
  userId: string;
  marketId: string;
  status: 'pending' | 'confirmed' | 'won' | 'lost' | 'void' | 'failed' | 'error';
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;

  // Campos do gerenciador de banca (salvos do betRequest)
  accountId: string;
  stake: number;
  odd: number;
  placedDate: string;
  appLoginId: string;
  sportId: string;
  sportName: string;
  competitionId: string;
  competitionName: string;
  eventId: string;
  sportEventId?: {
    eventIdMbook: string;
    eventIdSportRadar: string;
  }; // ID real do evento esportivo (sr:sport_event:XXXXX)
  eventName: string;
  eventDate: string;
  handicap: string | null;
  marketName: string;
  marketType: string;
  selectionId: string;
  selectionName: string;
  betRef: string;

  // Campos de resultado (preenchidos após processamento)
  payout?: number | null;
  refund?: number | null;
  resultReason?: string | null;
  eventsCount?: number;

  // Campos opcionais
  transaction?: {
    transactionId: string;
    amount: number;
  };
  apiResponse?: any;
  errorDetails?: any;

  // Campos legados (não mais usados, mantidos para compatibilidade)
  gameId?: string;
  gameName?: string;
  eventType?: 'side' | 'corner' | 'foul' | 'goal' | 'atLeastOne';
  selectedSide?: string;
  amount?: number;
  potentialWin?: number;
  biabCustomer?: string;
}

export interface Market {
  _id: string;
  marketId: string;
  status: 'betting' | 'game' | 'processing' | 'completed';
  openedAt: Date;
  closedAt: Date | null;
  gameStartedAt: Date | null;
  gameEndedAt: Date | null;
  processedAt: Date | null;
  totalBets: number;
  totalAmount: number;
  totalPayout: number | null;
  results: MarketResults | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketResults {
  events: GameEvent[];
  summary: {
    totalEvents: number;
    eventsByType: Record<string, number>;
  };
}

export interface GameEvent {
  gameId: string;
  marketId: string;
  originalType: string;
  mappedType: string | null;
  eventName: string;
  timestamp: string;
  matchTime?: number;
  matchClock?: string;
  competitor?: string;
  period?: string;
  periodType?: string;
  x?: number;
  y?: number;
  status?: string;
  matchStatus?: string;
  homeScore?: number;
  awayScore?: number;
}

export interface BetLog {
  betId: string;
  type: string;
  timestamp: string;
  data: any;
  createdAt: Date;
}

export interface ProcessBetResult {
  betId: string;
  status: 'won' | 'lost';
  winAmount: number;
  refundAmount: number;
  resultReason: string;
  eventsCount: number;
}

export interface Config {
  MONGO_URI: string;
  MONGO_DB_NAME: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_USERNAME?: string;
  REDIS_PASSWORD?: string;
  PROCESS_INTERVAL_MS: number;
  EXTERNAL_API_URL?: string;
  EXTERNAL_API_KEY?: string;
}
