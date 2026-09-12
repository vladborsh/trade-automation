import { Injectable, Logger } from '@nestjs/common';
import { Signal } from '@trade-automation/contracts';

/**
 * architecture/live-signal-server.md §4.4: "This is exactly where Integration Engineer's
 * position sizing / order logic attaches later; nothing about it is designed here."
 */
export interface ExecutionPort {
  onSignal(signal: Signal): Promise<void>;
}

export const EXECUTION_PORT = Symbol('EXECUTION_PORT');

@Injectable()
export class NoopExecution implements ExecutionPort {
  private readonly logger = new Logger(NoopExecution.name);

  async onSignal(signal: Signal): Promise<void> {
    this.logger.debug(`Noop execution for signal ${signal.id} (${signal.strategyId})`);
  }
}
