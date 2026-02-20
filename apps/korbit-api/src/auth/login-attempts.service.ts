import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type AttemptState = {
  count: number;
  lockUntil?: number;
};

@Injectable()
export class LoginAttemptsService {
  private readonly store = new Map<string, AttemptState>();
  private readonly maxAttempts = 5;
  private readonly lockMs = 10 * 60 * 1000;

  assertCanAttempt(key: string) {
    const state = this.store.get(key);
    if (!state?.lockUntil) {
      return;
    }

    const remaining = state.lockUntil - Date.now();
    if (remaining > 0) {
      throw new HttpException(
        `Login is temporarily blocked for ${Math.ceil(remaining / 1000)}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.store.delete(key);
  }

  registerFailure(key: string) {
    const current = this.store.get(key) ?? { count: 0 };
    const nextCount = current.count + 1;

    if (nextCount >= this.maxAttempts) {
      this.store.set(key, {
        count: nextCount,
        lockUntil: Date.now() + this.lockMs,
      });
      return;
    }

    this.store.set(key, { count: nextCount });
  }

  registerSuccess(key: string) {
    this.store.delete(key);
  }
}
