import { ObjectId } from 'mongodb';
import { getDb, getRedis } from './database';
import { Bet, GameEvent, ProcessBetResult, BetLog } from './types';
import { env } from './env';

/**
 * Processador de Apostas
 * Responsável por validar e finalizar apostas baseado nos eventos do mercado
 */
export class BetProcessor {
  private refundPercentage: number = 95; // Valor padrão

  /**
   * Carrega configurações de limites do Redis
   */
  private async loadLimits(): Promise<void> {
    try {
      const redis = getRedis();
      const limitsValue = await redis.get('prj-nextplay:limits:latest');

      if (limitsValue) {
        const parsed = JSON.parse(limitsValue);
        if (parsed.type === 'limits' && parsed.limits && parsed.limits.refund !== undefined) {
          this.refundPercentage = parsed.limits.refund;
          console.log(`[BetProcessor] Percentual de reembolso: ${this.refundPercentage}%`);
        }
      }
    } catch (error) {
      console.error('[BetProcessor] Erro ao carregar limites:', error);
      console.log(`[BetProcessor] Usando valor padrão de reembolso: ${this.refundPercentage}%`);
    }
  }

  /**
   * Busca apostas pendentes de mercados já processados
   */
  async findPendingBets(): Promise<Bet[]> {
    const db = getDb();
    const marketsCollection = db.collection('markets');
    const betsCollection = db.collection('bets');

    const processedMarkets = await marketsCollection
      .find({
        status: { $in: ['processing'] }
      })
      .toArray();

    console.log('[BetProcessor] Mercados encontrados:', processedMarkets.length);

    if (processedMarkets.length === 0) {
      return [];
    }

    const marketIds = processedMarkets.map(m => m.marketId);

    // Buscar apostas pendentes desses mercados
    const pendingBets = await betsCollection
      .find({
        marketId: { $in: marketIds },
        status: 'confirmed'
      })
      .toArray();

    return pendingBets as unknown as Bet[];
  }

  /**
   * Busca eventos de um mercado a partir dos results salvos
   */
  private async getMarketEvents(marketId: string): Promise<GameEvent[]> {
    const db = getDb();
    const marketsCollection = db.collection('markets');

    const market = await marketsCollection.findOne({ marketId });

    if (!market || !market.results) {
      console.log(`[BetProcessor] ⚠️  Mercado ${marketId} não tem results salvos`);
      return [];
    }

    const results = market.results;
    const events: GameEvent[] = [];

    // console.log(`[BetProcessor] 📊 Results do mercado:`, {
    //   totalEvents: results.totalEvents,
    //   sideA: results.eventsBySide?.A?.events?.length || 0,
    //   sideB: results.eventsBySide?.B?.events?.length || 0
    // });

    // Processar eventos do side A
    if (results.eventsBySide?.A?.events) {
      for (const event of results.eventsBySide.A.events) {
        events.push({
          gameId: results.eventsBySide.A.gameId,
          marketId: marketId,
          originalType: event.originalType,
          mappedType: event.type,
          eventName: event.eventName,
          timestamp: event.timestamp,
          matchTime: event.matchTime,
          matchClock: event.matchTime,
          competitor: event.competitor
        });
      }
    }

    // Processar eventos do side B
    if (results.eventsBySide?.B?.events) {
      for (const event of results.eventsBySide.B.events) {
        events.push({
          gameId: results.eventsBySide.B.gameId,
          marketId: marketId,
          originalType: event.originalType,
          mappedType: event.type,
          eventName: event.eventName,
          timestamp: event.timestamp,
          matchTime: event.matchTime,
          matchClock: event.matchTime,
          competitor: event.competitor
        });
      }
    }

    // Ordenar eventos por timestamp
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    console.log(`[BetProcessor] 📋 ${events.length} eventos carregados dos results`);

    return events;
  }

  /**
   * Processa resultado de uma aposta individual
   */
  private async processBetResult(bet: Bet, events: GameEvent[]): Promise<ProcessBetResult> {
    const { stake, odd } = bet;
    const amount = stake; // Compatibilidade - usar stake como amount

    // Extrair campos dos dados disponíveis
    const eventType = bet.marketName as 'side' | 'corner' | 'foul' | 'goal' | 'atLeastOne';
    // Usar sportEventId se disponível (ID real do sport event), senão usar eventId (fallback para apostas antigas)
    const gameId = bet?.sportEventId?.eventIdSportRadar;

    // Extrair selectedSide de selectionName (ex: "Lateral ira acontecer no JOGO A - Arsenal vs Liverpool")
    const selectedSideMatch = bet.selectionName?.match(/JOGO ([AB])/i);
    const selectedSide = selectedSideMatch ? selectedSideMatch[1] : 'A';

    console.log(`[BetProcessor] Processando aposta ${bet.betId}:`, {
      eventType,
      sportEventId: gameId,
      eventId: bet.eventId,
      selectedSide,
      amount,
      totalEvents: events.length,
      events,
      refundPercentage: `${this.refundPercentage}%`
    });

    let isWinner = false;
    let resultReason = '';
    let winAmount = 0;
    let refundAmount = 0;

    // Lógica especial para "atLeastOne" - ganha se houver QUALQUER evento no jogo apostado
    if (eventType === 'atLeastOne') {
      const eventsInBetGame = events.filter(e =>
        e.gameId === gameId &&
        e.mappedType &&
        ['side', 'corner', 'foul', 'goal'].includes(e.mappedType)
      );

      isWinner = eventsInBetGame.length > 0;
      resultReason = isWinner
        ? `${eventsInBetGame.length} evento(s) ocorreu(ram) no jogo ${selectedSide}`
        : `Nenhum evento ocorreu no jogo ${selectedSide}`;

      if (isWinner) {
        winAmount = Math.floor(amount * odd);
      } else {
        // Se não houve eventos em nenhum jogo, reembolso conforme configurado
        const anyEventInAnyGame = events.some(e =>
          e.mappedType && ['side', 'corner', 'foul', 'goal'].includes(e.mappedType)
        );
        if (!anyEventInAnyGame) {
          refundAmount = Math.round(amount * (this.refundPercentage / 100));
          resultReason = `Nenhum evento ocorreu em nenhum jogo - Reembolso de ${this.refundPercentage}%`;
        }
      }
    }

    // Aposta normal em jogo específico (A ou B) - qual jogo terá o evento PRIMEIRO
    else {
      // Buscar todos os eventos do tipo apostado em TODOS os jogos
      const eventsOfType = events.filter(e => e.mappedType === eventType);

      console.log(`[BetProcessor] 🔍 Debug: eventType=${eventType}, eventsOfType.length=${eventsOfType.length}, events.length=${events.length}`);

      if (eventsOfType.length === 0) {
        // Nenhum evento do tipo ocorreu em nenhum jogo - REEMBOLSO conforme configurado
        isWinner = false;
        refundAmount = amount * (this.refundPercentage / 100);
        resultReason = `Nenhum evento do tipo ${eventType} ocorreu em nenhum jogo - Reembolso de ${this.refundPercentage}%`;
        console.log(`[BetProcessor] 🔄 Aplicando reembolso: amount=${amount}, refundPercentage=${this.refundPercentage}, refundAmount=${refundAmount}`);
      } else {
        // Ordenar eventos por timestamp para encontrar o PRIMEIRO
        eventsOfType.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const firstEvent = eventsOfType[0];

        // Verifica se o primeiro evento foi no jogo apostado
        isWinner = firstEvent.gameId === gameId;

        if (isWinner) {
          winAmount = Math.floor(amount * odd);
          resultReason = `O primeiro ${eventType} ocorreu no jogo ${selectedSide} às ${firstEvent.matchClock || firstEvent.timestamp}`;
        } else {
          // O primeiro evento foi no outro jogo - PERDE TUDO
          refundAmount = 0;
          resultReason = `O primeiro ${eventType} ocorreu no jogo oposto às ${firstEvent.matchClock || firstEvent.timestamp}`;
        }
      }
    }

    // Contar eventos relevantes para esta aposta
    const relevantEventsCount = events.filter(e =>
      e.mappedType === eventType && e.gameId === gameId
    ).length;

    return {
      betId: bet.betId,
      status: isWinner ? 'won' : 'lost',
      winAmount,
      refundAmount,
      resultReason,
      eventsCount: relevantEventsCount
    };
  }

  /**
   * Atualiza status da aposta no banco
   */
  private async updateBetStatus(result: ProcessBetResult): Promise<void> {
    const db = getDb();
    const betsCollection = db.collection('bets');

    // Determina o status final baseado no resultado
    let finalStatus: 'won' | 'lost' | 'void';
    if (result.status === 'won') {
      finalStatus = 'won';
    } else if (result.refundAmount > 0) {
      // Se tem reembolso, marca como 'void'
      finalStatus = 'lost';
    } else {
      finalStatus = 'lost';
    }

    await betsCollection.updateOne(
      { betId: result.betId },
      {
        $set: {
          status: finalStatus,
          payout: result.winAmount > 0 ? result.winAmount : null,
          refund: result.refundAmount > 0 ? result.refundAmount : null,
          resultReason: result.resultReason,
          eventsCount: result.eventsCount,
          processedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    console.log(`[BetProcessor] ✅ Aposta ${result.betId} atualizada: ${finalStatus}`);
  }

  /**
   * Adiciona log à aposta
   */
  private async addBetLog(betId: string, logData: Partial<BetLog>): Promise<void> {
    const db = getDb();
    const logsCollection = db.collection('bet_logs');

    await logsCollection.insertOne({
      betId,
      type: logData.type,
      timestamp: logData.timestamp || new Date().toISOString(),
      data: logData.data || logData,
      createdAt: new Date()
    });
  }

  /**
   * Gera um novo ID de transação
   */
  private generateTransactionId(betId: string): string {
    return `txn_${Date.now()}_${betId.slice(-8)}`;
  }

  /**
   * Envia resultado da aposta para API externa (gerenciador de banca)
   * @param bet - Aposta original com todos os dados
   * @param status - 'WON' para vitória, 'LOST' para derrota, 'VOID' para reembolso
   * @param amount - Valor do pagamento (para WON/VOID) ou 0 (para LOST)
   */
  private async sendBetResultToAPI(bet: Bet, status: 'WON' | 'LOST' | 'VOID', amount: number): Promise<boolean> {
    try {
      // const apiUrl = 'https://ua5pajgphh.execute-api.sa-east-1.amazonaws.com/fulltbet/fast-market';
      const apiUrl = env.EXTERNAL_API_URL

      // Prepara o payload baseado no documento original da aposta
      const payload: any = {
        bets: [{
          accountId: bet.accountId,
          status: status === "VOID" ? "LOST" : status,
          betId: bet.betId,
          stake: bet.stake,
          odd: bet.odd,
          lastUpdated: new Date().toISOString(),
          placedDate: bet.placedDate,
          appLoginId: bet.appLoginId,
          sportId: bet.sportId,
          sportName: bet.sportName,
          competitionId: bet.competitionId,
          competitionName: bet.competitionName,
          eventId: bet.eventId,
          eventName: bet.eventName,
          eventDate: bet.eventDate,
          handicap: bet.handicap || null,
          marketId: bet.marketId,
          marketName: bet.marketName,
          marketType: bet.marketType,
          selectionId: bet.selectionId,
          selectionName: bet.selectionName,
          betRef: bet.betRef,
          profit: 0,
        }]
      };
      // Se for vitória (WON), adiciona transaction com valor positivo e profit
      if (status === 'WON' && amount > 0) {
        const newTransactionId = this.generateTransactionId(bet.betId);
        payload.bets[0].transaction = {
          transactionId: newTransactionId,
          amount: parseFloat(amount.toFixed(2)) // Valor positivo para crédito com 2 casas decimais
        };
        payload.bets[0].profit = parseFloat((bet.stake * (bet.odd - 1)).toFixed(2)); // Lucro líquido com 2 casas decimais
      }
      // Se for reembolso (VOID), adiciona transaction
      else if (status === 'VOID' && amount > 0) {
        let refundAmount = amount
        const newTransactionId = this.generateTransactionId(bet.betId);
        payload.bets[0].transaction = {
          transactionId: newTransactionId,
          amount: parseFloat(amount.toFixed(2))
        }
        payload.bets[0].profit = parseFloat((-(bet.stake - refundAmount)).toFixed(2))
      }
      // Se for derrota (LOST), não precisa de transaction nem profit
      else if (status === 'LOST') {
        // Não adiciona profit para LOST
        payload.bets[0].profit = -(bet.stake)
      }

      console.log(`[BetProcessor] 📤 Enviando resultado para API: ${status}`, {
        betId: bet.betId,
        status,
        amount: amount || 0
      });

      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });


      console.log(payload, payload?.bets[0]?.transaction)
      // throw new Error( "ERROR API")
      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        console.log(await response.json())
        console.error(`[BetProcessor] ❌ API retornou erro ${response.status}:`, errorData);
        throw new Error(`API retornou status ${response.status}: ${errorData.message || response.statusText}`);
      }

      // console.log(`[BetProcessor] ✅ Resultado enviado com sucesso para API:`, responseData);

      return true;
    } catch (error) {
      console.error('[BetProcessor] ❌ Erro ao enviar resultado para API externa:', error);
      return false;
    }
  }

  /**
   * Processa créditos e débitos para uma aposta finalizada
   * Retorna true se a API respondeu com sucesso, false caso contrário
   */
  private async processPaymentsWithRetry(bet: Bet, result: ProcessBetResult): Promise<boolean> {
    const { userId, stake, betId } = bet;
    const amount = stake; // Compatibilidade
    const { status, winAmount, refundAmount } = result;

    let apiSuccess = false;
    let apiStatus: 'WON' | 'LOST' | 'VOID' = 'LOST';
    let paymentAmount = 0;

    try {
      // VITÓRIA - Envia WON para API com transaction
      if (status === 'won' && winAmount > 0) {
        console.log(`[BetProcessor] 🎉 Vitória! Processando pagamento de ${winAmount} para usuário ${userId}`);
        apiStatus = 'WON';
        paymentAmount = winAmount;

        // Envia resultado para API externa (gerenciador de banca)
        apiSuccess = await this.sendBetResultToAPI(bet, 'WON', winAmount);

        await this.addBetLog(betId, {
          type: 'balance_credited',
          data: {
            amount: winAmount,
            reason: 'bet_win',
            success: apiSuccess,
            apiStatus: 'WON',
            timestamp: new Date().toISOString()
          }
        });

        if (!apiSuccess) {
          console.error(`[BetProcessor] ⚠️ Falha ao enviar resultado WON para API - betId: ${betId}`);
        }
      }
      // REEMBOLSO - Envia como VOID com valor do reembolso
      else if (refundAmount > 0) {
        const lostAmount = parseFloat((amount - refundAmount).toFixed(2));

        console.log(`[BetProcessor] 🔄 Reembolso de ${refundAmount.toFixed(2)} para usuário ${userId}`);
        console.log(`[BetProcessor] 💸 Taxa da casa: ${lostAmount}`);

        apiStatus = 'VOID';
        paymentAmount = refundAmount;

        // Envia reembolso como VOID para API
        apiSuccess = await this.sendBetResultToAPI(bet, 'VOID', refundAmount);

        await this.addBetLog(betId, {
          type: 'balance_credited',
          data: {
            amount: refundAmount,
            reason: 'bet_refund',
            success: apiSuccess,
            apiStatus: 'LOST',
            houseFee: lostAmount,
            timestamp: new Date().toISOString()
          }
        });

        if (!apiSuccess) {
          console.error(`[BetProcessor] ⚠️ Falha ao enviar reembolso (VOID) para API - betId: ${betId}`);
        }
      }
      // DERROTA TOTAL - Envia LOST para API (sem transaction)
      else {
        console.log(`[BetProcessor] ❌ Derrota! Perda de ${amount} para usuário ${userId}`);

        apiStatus = 'LOST';
        paymentAmount = 0;

        // Envia resultado para API externa (gerenciador de banca)
        apiSuccess = await this.sendBetResultToAPI(bet, 'LOST', 0);

        await this.addBetLog(betId, {
          type: 'lost_recorded',
          data: {
            amount: amount,
            success: apiSuccess,
            apiStatus: 'LOST',
            timestamp: new Date().toISOString()
          }
        });

        if (!apiSuccess) {
          console.error(`[BetProcessor] ⚠️ Falha ao enviar resultado LOST para API - betId: ${betId}`);
        }
      }

      return apiSuccess;

    } catch (error) {
      console.error(`[BetProcessor] ❌ Exceção ao processar pagamento - betId: ${betId}:`, error);

      await this.addBetLog(betId, {
        type: 'payment_error',
        data: {
          error: error instanceof Error ? error.message : String(error),
          apiStatus,
          amount: paymentAmount,
          timestamp: new Date().toISOString()
        }
      });

      return false;
    }
  }

  /**
   * Marca mercado como concluído após processar todas apostas
   */
  private async completeMarket(marketId: string): Promise<void> {
    const db = getDb();
    const marketsCollection = db.collection('markets');
    const betsCollection = db.collection('bets');

    // Calcular total de payouts
    const wonBets = await betsCollection
      .find({ marketId, status: 'won' })
      .toArray();

    const totalPayout = wonBets.reduce((sum, bet) => sum + (bet.payout || 0), 0);

    // Atualizar mercado para status 'completed'
    await marketsCollection.updateOne(
      { marketId },
      {
        $set: {
          status: 'completed',
          totalPayout,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    console.log(`[BetProcessor] 🏆 Mercado ${marketId} concluído (Total pago: R$ ${(totalPayout / 100).toFixed(2)})`);
  }

  /**
   * Processa todas as apostas pendentes
   */
  async processPendingBets(): Promise<void> {
    try {
      // Carregar configurações
      await this.loadLimits();

      // Buscar apostas pendentes
      const pendingBets = await this.findPendingBets();

      if (pendingBets.length === 0) {
        console.log('[BetProcessor] Nenhuma aposta pendente para processar');
        return;
      }

      console.log(`[BetProcessor] 📋 ${pendingBets.length} apostas pendentes encontradas`);

      // Agrupar apostas por mercado
      const betsByMarket = new Map<string, Bet[]>();
      for (const bet of pendingBets) {
        if (!betsByMarket.has(bet.marketId)) {
          betsByMarket.set(bet.marketId, []);
        }
        betsByMarket.get(bet.marketId)!.push(bet);
      }

      // Processar cada mercado
      for (const [marketId, bets] of betsByMarket.entries()) {
        console.log(`[BetProcessor] 🎯 Processando mercado ${marketId} (${bets.length} apostas)`);

        // Buscar eventos do mercado
        const events = await this.getMarketEvents(marketId);
        console.log(`[BetProcessor] 📊 ${events.length} eventos encontrados no mercado`);

        let successCount = 0;
        let failureCount = 0;

        // Processar cada aposta
        for (const bet of bets) {
          try {
            // Calcular resultado
            const result = await this.processBetResult(bet, events);

            // PRIMEIRO: Tentar processar pagamentos na API externa
            const apiSuccess = await this.processPaymentsWithRetry(bet, result);

            if (!apiSuccess) {
              // Se a API falhou, NÃO atualiza o banco e loga o erro
              console.error(`[BetProcessor] ❌ API falhou para aposta ${bet.betId} - Banco NÃO foi atualizado`);

              await this.addBetLog(bet.betId, {
                type: 'api_error',
                data: {
                  error: 'Falha ao comunicar com API externa - aposta não finalizada',
                  status: result.status,
                  resultReason: result.resultReason,
                  timestamp: new Date().toISOString()
                }
              });

              failureCount++;
              continue; // Pula para próxima aposta sem atualizar o banco
            }

            // SEGUNDO: Só atualiza o banco SE a API respondeu com sucesso
            await this.updateBetStatus(result);

            // Adicionar log de resultado
            await this.addBetLog(bet.betId, {
              type: 'bet_result',
              data: {
                status: result.status,
                resultReason: result.resultReason,
                eventsCount: result.eventsCount,
                winAmount: result.winAmount,
                refundAmount: result.refundAmount,
                apiSuccess: true,
                timestamp: new Date().toISOString()
              }
            });

            console.log(`[BetProcessor] ✅ Aposta ${bet.betId} finalizada:`, {
              status: result.status,
              winAmount: result.winAmount,
              refundAmount: result.refundAmount
            });

            successCount++;

          } catch (error) {
            console.error(`[BetProcessor] ❌ Erro ao processar aposta ${bet.betId}:`, error);

            // Adicionar log de erro
            await this.addBetLog(bet.betId, {
              type: 'processing_error',
              data: {
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
              }
            });

            failureCount++;
          }
        }

        // SÓ marca mercado como concluído se TODAS as apostas foram processadas com sucesso
        if (failureCount === 0) {
          await this.completeMarket(marketId);
          console.log(`[BetProcessor] ✅ Mercado ${marketId} concluído: ${successCount} apostas processadas`);
        } else {
          console.warn(`[BetProcessor] ⚠️ Mercado ${marketId} NÃO concluído: ${successCount} sucessos, ${failureCount} falhas - Apostas com falha serão reprocessadas`);
        }
      }

      console.log('[BetProcessor] ✅ Todas as apostas foram processadas');
    } catch (error) {
      console.error('[BetProcessor] ❌ Erro no processamento de apostas:', error);
      throw error;
    }
  }
}
